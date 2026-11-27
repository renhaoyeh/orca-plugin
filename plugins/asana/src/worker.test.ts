import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker'
import { detail as exampleDetail } from './fixtures'
import { asanaClient } from './asana-client.mjs'
const fake = { image: async () => '', subtasks: async () => [], validate: async () => { throw Error('Original Asana token save does not validate over the network') }, projects: async () => ({ items: [], next: null }), issues: async () => ({ items: [], next: null }), detail: async () => exampleDetail, projectInfo: async (id: string) => ({ id, name: 'Asana project', workspaceId: '1' }) }
const input = { url: '', token: 'test-only-token' }
const capabilities = ['secrets:own', 'storage:own', 'workspace:read']
test('shares reads across views and invalidates them on refresh or token changes', async () => {
  let listCalls = 0, detailCalls = 0
  const host = mockHost({ capabilities, secrets: { 'connection.v1': JSON.stringify({ token: input.token }) } })
  const client = {
    ...fake,
    issues: async () => { listCalls++; return { items: [], next: null } },
    detail: async () => { detailCalls++; return exampleDetail },
  }
  const worker = await mountWorker({ default: createWorker(() => client, async () => 'repo-a') }, { host })
  const list = { project: '12', cursor: null, tab: 'mine' as const }
  const detail = { id: '42', project: '12' }
  await Promise.all([worker.request('issues.list', list), worker.request('issues.list', list)])
  await worker.request('issues.detail', detail)
  await worker.request('connection.read')
  await worker.request('issues.list', list)
  await worker.request('issues.detail', detail)
  assert.equal(listCalls, 1)
  assert.equal(detailCalls, 1)
  await worker.request('data.refresh')
  await worker.request('issues.list', list)
  await worker.request('issues.list', { ...list, tab: 'all' })
  await worker.request('issues.detail', detail)
  assert.equal(listCalls, 3)
  assert.equal(detailCalls, 2)
  await worker.request('connection.save', { ...input, token: 'changed-token' })
  await worker.request('issues.detail', detail)
  assert.equal(detailCalls, 3)
  await worker.request('connection.remove')
  await assert.rejects(worker.request('issues.detail', detail), /Connect/)
  await worker.deactivate()
})

test('Asana token autosave uses encrypted secrets; metadata never returns a token', async () => {
  const host = mockHost({ capabilities })
  const worker = await mountWorker({ default: createWorker(() => fake, async () => 'repo-a') }, { host })
  const saved = await worker.request('connection.save', input)
  assert.equal(saved.configured, true)
  assert.ok(!JSON.stringify(saved).includes(input.token))
  assert.equal(JSON.parse(host.data().secrets['connection.v1'] as string).token, input.token)
  await worker.request('connection.remove')
  assert.equal((await worker.request('connection.read')).configured, false)
  await assert.rejects(worker.request('issues.detail', { id: '42' }), /Connect/)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
test('project bindings are restored per workspace and stale workspace writes are rejected', async () => {
  let scope = 'repo-a'
  const host = mockHost({ capabilities, secrets: { 'connection.v1': JSON.stringify({ token: input.token }) } })
  const worker = await mountWorker({ default: createWorker(() => fake, async () => scope) }, { host })
  await worker.request('project.bind', { id: '12', scope: 'repo-a' })
  assert.equal((await worker.request('connection.read')).binding?.id, '12')
  scope = 'repo-b'
  assert.equal((await worker.request('connection.read')).binding, null)
  await assert.rejects(worker.request('project.bind', { id: '13', scope: 'repo-a' }), /Workspace changed/)
  await worker.request('project.bind', { id: '13', scope: 'repo-b' })
  scope = 'repo-a'
  assert.equal((await worker.request('connection.read')).binding?.id, '12')
  assert.ok(!JSON.stringify(host.data().storage).includes(input.token))
  await worker.deactivate()
})
test('invalid tokens do not overwrite existing credentials and Mine/All preference survives reopening', async () => {
  const raw = JSON.stringify({ token: input.token })
  const host = mockHost({ capabilities, secrets: { 'connection.v1': raw } })
  const worker = await mountWorker({ default: createWorker(() => fake, async () => 'repo-a') }, { host })
  await assert.rejects(worker.request('connection.save', { url: '', token: 'bad\nheader' }), /valid API token/)
  assert.equal(host.data().secrets['connection.v1'], raw)
  await worker.request('view.save', { tab: 'all' })
  assert.equal((await worker.request('connection.read')).tab, 'all')
  await worker.deactivate()
})

function mcpHarness(path: string, makeClient: typeof asanaClient | ((kind: 'asana', config: any) => any) = () => ({ ...fake, detail: async (id: string) => ({ ...exampleDetail, id }) })) {
  const scope = JSON.stringify(['local', path])
  const storage: Record<string, any> = { 'bindings.v1': { [scope]: { id: '12', name: 'Fixture project' } } }
  const handlers: Record<string, (input?: any) => Promise<any> | any> = {}
  const workspaces = [
    { id: 'ws-a', path, hostId: 'local', projectId: 'repo', kind: 'worktree', name: 'A', branch: 'main' },
    { id: 'ws-b', path, hostId: 'local', projectId: 'repo', kind: 'worktree', name: 'B', branch: 'main' },
  ]
  let focused = 'ws-a'
  let queuedContextRead: (() => Promise<void>) | undefined
  const orca: any = {
    grantedCapabilities: capabilities,
    hooks: { on: () => ({ dispose() {} }) },
    panels: { handle: (name: string, handler: (input?: any) => unknown) => { handlers[name] = handler as any } },
    log: () => {},
    host: { call: async (method: string, args: any = {}) => {
      if (method === 'workspace.readContext') {
        const wait = queuedContextRead
        queuedContextRead = undefined
        if (wait) await wait()
        return { workspaceId: focused, branch: 'main', displayName: 'Repo', terminals: [] }
      }
      if (method === 'workspace.list') return { workspaces, truncated: false }
      if (method === 'project.list') return { projects: [{ id: 'repo', name: 'Repo', path, hostId: 'local', kind: 'git' }], truncated: false }
      if (method === 'secrets.get') return { value: JSON.stringify({ token: input.token }) }
      if (method === 'storage.get') return { value: storage[args.key] }
      if (method === 'storage.set') { storage[args.key] = args.value; return { ok: true } }
      throw Error(`Unexpected host call: ${method}`)
    } },
  }
  return createWorker(makeClient as any, async () => scope, undefined, async readTask => { handlers.readTask = readTask; return async () => {} })(orca).then(() => ({ handlers, storage, focus(id: string) { focused = id }, delayNextContext() {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    queuedContextRead = () => gate
    return release
  } }))
}

test('MCP selection isolates same-repository workspaces and serves a background caller', async () => {
  const harness = await mcpHarness('C:/repo')
  const scope = JSON.stringify(['local', 'C:/repo'])
  await harness.handlers['tasks.selection.save']({ workspaceId: 'ws-a', scope, project: '12', id: '42' })
  harness.focus('ws-b')
  await harness.handlers['tasks.selection.save']({ workspaceId: 'ws-b', scope, project: '12', id: '43' })
  assert.equal((await harness.handlers.readTask({ cwd: 'C:/repo', workspaceId: 'ws-a' })).id, '42')
  assert.equal((await harness.handlers.readTask({ cwd: 'C:/repo', workspaceId: 'ws-b' })).id, '43')
  await assert.rejects(harness.handlers.readTask({ cwd: 'C:/repo', workspaceId: 'ws-unknown' }), /does not match/)
  await assert.rejects(harness.handlers['tasks.selection.save']({ workspaceId: 'ws-a', scope, project: '12', id: '44' }), /Workspace changed/)
  assert.equal(new Set(Object.keys(harness.storage).filter(key => key.startsWith('current-task.v1.'))).size, 2)
})

test('MCP rejects a selection change while Asana detail is loading', async () => {
  let release!: (value: typeof exampleDetail) => void
  const harness = await mcpHarness('C:/repo', () => ({ ...fake, detail: () => new Promise<typeof exampleDetail>(resolve => { release = resolve }) }))
  const scope = JSON.stringify(['local', 'C:/repo'])
  await harness.handlers['tasks.selection.save']({ workspaceId: 'ws-a', scope, project: '12', id: '42' })
  const result = harness.handlers.readTask({ cwd: 'C:/repo', workspaceId: 'ws-a' })
  while (!release) await new Promise(resolve => setTimeout(resolve, 0))
  await harness.handlers['tasks.selection.save']({ workspaceId: 'ws-a', scope, project: '12', id: '43' })
  release(exampleDetail)
  await assert.rejects(result, /selection.*changed/)
})

test('selection writes serialize by arrival so an earlier slow select cannot overwrite a later clear', async () => {
  const harness = await mcpHarness('C:/repo')
  const scope = JSON.stringify(['local', 'C:/repo'])
  const release = harness.delayNextContext()
  const earlierSelect = harness.handlers['tasks.selection.save']({ workspaceId: 'ws-a', scope, project: '12', id: '42' })
  const laterClear = harness.handlers['tasks.selection.save']({ workspaceId: 'ws-a', scope, project: '12', id: null })
  release()
  await Promise.all([earlierSelect, laterClear])
  const selectionKey = Object.keys(harness.storage).find(key => key.startsWith('current-task.v1.'))
  assert.equal(harness.storage[selectionKey!], null)
})

test('get_current_task reads a current task and subtasks through asanaClient fixture transport', async () => {
  const paths: string[] = []
  const request = async (value: string | URL | Request) => {
    const url = new URL(value.toString())
    paths.push(url.pathname)
    if (url.pathname === '/api/1.0/tasks/42') return new Response(JSON.stringify({ data: {
      gid: '42', name: 'Fixture task', notes: 'Local fixture notes', html_notes: '', completed: false,
      permalink_url: 'https://app.asana.com/0/12/42',
      memberships: [], parent: { gid: '41', name: 'Fixture parent', permalink_url: 'https://app.asana.com/0/12/41' },
    } }))
    if (url.pathname === '/api/1.0/tasks/42/stories') {
      const start = url.searchParams.get('offset') === 'after-30' ? 30 : 0
      const end = start ? 35 : 30
      return new Response(JSON.stringify({ data: Array.from({ length: end - start }, (_, index) => {
        const number = start + index + 1
        return { gid: String(number), resource_subtype: 'comment_added', text: `Comment ${number}`, created_at: new Date(Date.UTC(2026, 0, number)).toISOString(), created_by: { name: 'Fixture user' } }
      }), next_page: start ? null : { offset: 'after-30' } }))
    }
    if (url.pathname === '/api/1.0/tasks/42/subtasks') return new Response(JSON.stringify({ data: [{ gid: '43', name: 'Fixture subtask', completed: false, permalink_url: 'https://app.asana.com/0/12/43', memberships: [{ project: { gid: '12' } }] }], next_page: null }))
    if (url.pathname === '/api/1.0/attachments') throw Error('MCP must not request images')
    throw Error(`Unexpected fixture request ${url.pathname}`)
  }
  const clientFactory = (_kind: 'asana', config: any) => asanaClient('asana', config, async (url, init) => {
    const authorization = new Headers(init?.headers).get('authorization')
    assert.equal(authorization, 'Bearer test-only-token')
    return request(url)
  })
  const harness = await mcpHarness('C:/Code/orca-plugin', clientFactory)
  const scope = JSON.stringify(['local', 'C:/Code/orca-plugin'])
  await harness.handlers['tasks.selection.save']({ workspaceId: 'ws-a', scope, project: '12', id: '42' })
  const task = await harness.handlers.readTask({ cwd: 'c:/code/ORCA-PLUGIN', workspaceId: 'ws-a' })
  assert.equal(task.title, 'Fixture task')
  assert.equal(task.description, 'Local fixture notes')
  assert.equal(task.comments.length, 30)
  assert.deepEqual(task.comments.slice(-5).map((comment: any) => comment.id), ['31', '32', '33', '34', '35'])
  assert.equal((await harness.handlers['issues.subtasks']({ id: '42' }))[0].id, '43')
  assert.equal(paths.filter(path => path.endsWith('/stories')).length, 2)
  assert.equal(paths.includes('/api/1.0/attachments'), false)
})

test('Agent handoff discovers available CLIs and only launches in the still-focused workspace', async () => {
  const host = mockHost({ capabilities: [...capabilities, 'workspace:read', 'agent:launch'], results: {
    'workspace.readContext': { workspaceId: 'ws-1', branch: 'main', displayName: 'Workspace', terminals: [] },
    'workspace.list': { workspaces: [{ id: 'ws-1', path: 'C:/repo', hostId: 'local', kind: 'worktree', name: 'Workspace', branch: 'main', projectId: 'repo-1' }], truncated: false },
  } })
  const calls: string[][] = []
  const runCli = async (args: string[]) => {
    calls.push(args)
    return args[1] === 'installed' ? { agents: [{ id: 'codex', name: 'Codex', default: true }] } : {}
  }
  const worker = await mountWorker({ default: createWorker(() => fake, async () => 'repo-a', runCli) }, { host })
  assert.deepEqual(await worker.request('agent.options', undefined), { workspaceId: 'ws-1', agents: [{ id: 'codex', name: 'Codex', default: true }] })
  assert.deepEqual(await worker.request('agent.launch', { workspaceId: 'ws-1', agent: 'codex', prompt: 'Reviewed task' }), { started: true })
  assert.deepEqual(calls.map(args => args.slice(0, 4)), [
    ['agent', 'installed', '--worktree', 'id:ws-1'],
    ['agent', 'launch', '--agent', 'codex'],
  ])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('Agent handoff rejects a changed workspace before launch', async () => {
  const host = mockHost({ capabilities: [...capabilities, 'workspace:read', 'agent:launch'], results: {
    'workspace.readContext': { workspaceId: 'ws-other', branch: 'main', displayName: 'Other', terminals: [] },
  } })
  let calls = 0
  const worker = await mountWorker({ default: createWorker(() => fake, async () => 'repo-a', async () => { calls++; return {} }) }, { host })
  await assert.rejects(worker.request('agent.launch', { workspaceId: 'ws-1', agent: 'codex', prompt: 'Reviewed task' }), /Workspace changed/)
  assert.equal(calls, 0)
  await worker.deactivate()
})
