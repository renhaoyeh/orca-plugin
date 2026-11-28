import { assert, test, type MockRequests } from 'orca/testing'
import type { PluginBridgeApi } from 'orca/host'
import { createPanelState } from './panel-state'
import type { ConnectionState } from './protocol'
import { connected, requests, projects, detail, issues } from './fixtures'

function createModel(overrides: MockRequests = {}, onChange = () => {}) {
  const handlers: MockRequests = { ...requests, ...overrides }
  const recorded: { name: string; input: unknown }[] = []
  const request = (async (name: keyof typeof handlers, input?: unknown) => {
    recorded.push({ name, input })
    return (handlers[name] as (input: unknown) => unknown)(input)
  }) as PluginBridgeApi['request']
  return { ...createPanelState(request, onChange), recorded }
}

const project = projects.items[0]
const bound = { ...connected, binding: project }

test('saving a token opens project search and waits for an explicit binding', async () => {
  const model = createModel({
    'connection.read': () => ({ configured: false, url: '', workspaceId: null }),
    'connection.save': () => connected,
    'connection.remove': () => ({ configured: false, url: '', workspaceId: null }),
  })
  await model.reload()
  assert.equal(model.state.settings, true)
  model.editToken('test-only-token')
  await model.saveToken()
  assert.equal(model.state.token, '')
  assert.deepEqual(model.state.projects, projects.items)
  assert.equal(Boolean(model.state.project), false)
  assert.equal(model.recorded.some(({ name }) => name === 'project.bind'), false)
  await model.bindProject(project)
  assert.equal(model.state.project?.id, project.id)
  assert.equal(model.state.issues[0].id, detail.id)
  model.onWorkspace('workspace-a')
  await model.openTask(detail.id)
  assert.ok(model.recorded.some(({ name, input }) => name === 'tasks.selection.save' && (input as any)?.project === project.id && (input as any)?.id === detail.id))
  await model.disconnect()
  assert.deepEqual(model.state.issues, [])
  assert.equal(model.state.config?.configured, false)
  model.dispose()
})

test('restores the binding and remembers the list while navigating an open task', async () => {
  const model = createModel({
    'connection.read': () => bound,
    'issues.detail': input => input.id === '44'
      ? { ...detail, id: '44', title: 'Check redirect target', description: 'Child task description', subtasks: 0, parent: { id: '42', title: detail.title } }
      : detail,
  })
  await model.reload()
  assert.equal(model.recorded.some(({ name }) => name === 'projects.list'), false)
  model.setQuery('login')
  model.toggleSection('Backlog')
  await model.openTask(detail.id)
  assert.equal(model.state.detail?.id, detail.id)
  await model.openTask('44')
  assert.equal(model.state.detail?.parent?.id, detail.id)
  model.back()
  assert.equal(model.state.detail?.id, detail.id)
  assert.equal(model.state.children[0].id, '44')
  model.back()
  assert.equal(model.state.detail, null)
  assert.equal(model.state.query, 'login')
  assert.ok(model.state.collapsedSections.has('Backlog'))
  model.dispose()
})

test('current-task selection follows navigation, Back, list clear, and workspace identity', async () => {
  const model = createModel({ 'connection.read': () => ({ ...bound, workspaceId: 'workspace-a' }) })
  await model.reload()
  await model.openTask(detail.id)
  await model.openTask('44')
  model.back()
  model.back(true)
  const selections = model.recorded.filter(({ name }) => name === 'tasks.selection.save').map(({ input }) => input)
  assert.deepEqual(selections, [
    { workspaceId: 'workspace-a', scope: connected.scope, project: project.id, id: null },
    { workspaceId: 'workspace-a', scope: connected.scope, project: project.id, id: detail.id },
    { workspaceId: 'workspace-a', scope: connected.scope, project: project.id, id: '44' },
    { workspaceId: 'workspace-a', scope: connected.scope, project: project.id, id: detail.id },
    { workspaceId: 'workspace-a', scope: connected.scope, project: project.id, id: null },
  ])
  model.dispose()
})

test('initial identity and same-project workspace switch synchronize the displayed task', async () => {
  let activeWorkspace = 'workspace-a'
  const model = createModel({ 'connection.read': () => ({ ...bound, workspaceId: activeWorkspace }) })
  await model.reload()
  await model.openTask(detail.id)
  activeWorkspace = 'workspace-b'
  model.onWorkspace(activeWorkspace)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(model.state.detailId, detail.id)
  assert.equal(model.state.config?.workspaceId, 'workspace-b')
  const selections = model.recorded.filter(({ name }) => name === 'tasks.selection.save').map(({ input }) => input)
  assert.deepEqual(selections.at(-1), { workspaceId: 'workspace-b', scope: connected.scope, project: project.id, id: detail.id })
  model.dispose()
})

test('requests project matches from Asana and avoids rebinding the current project', async () => {
  const model = createModel({
    'connection.read': () => bound,
    'projects.list': input => ({ items: [{ id: '99', name: input.query || 'Initial project' }], next: null }),
  })
  await model.reload()
  await model.chooseProject()
  model.searchProjects('remote match', true)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(model.state.projects[0].name, 'remote match')
  await model.bindProject(project)
  assert.equal(model.state.picker, false)
  assert.equal(model.recorded.some(({ name }) => name === 'project.bind'), false)
  model.dispose()
})

test('Mine and All reuse their own pages, while Refresh fetches them again', async () => {
  const model = createModel({ 'connection.read': () => bound })
  await model.reload()
  model.setQuery('login')
  await model.selectTab('all')
  await model.selectTab('mine')
  assert.equal(model.state.query, 'login')
  assert.deepEqual(model.recorded.filter(({ name }) => name === 'issues.list').map(({ input }) => (input as { tab: string }).tab), ['mine', 'all'])
  await model.refresh()
  assert.equal(model.recorded.filter(({ name }) => name === 'issues.list').length, 3)
  model.dispose()
})

test('Show subtasks defaults on, restores saved off state, and persists toggles', async () => {
  const model = createModel({
    'connection.read': () => ({ ...bound, showSubtasks: false }),
    'subtasks.preference.save': () => ({ ok: true }),
  })
  await model.reload()
  assert.equal(model.state.showSubtasks, false)
  model.toggleShowSubtasks()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(model.state.showSubtasks, true)
  assert.deepEqual(model.recorded.filter(({ name }) => name === 'subtasks.preference.save').map(({ input }) => input), [{ enabled: true }])

  const defaultModel = createModel({ 'connection.read': () => bound, 'subtasks.preference.save': () => ({ ok: true }) })
  await defaultModel.reload()
  assert.equal(defaultModel.state.showSubtasks, true)
  defaultModel.toggleShowSubtasks()
  await defaultModel.loadSubtasks('42')
  assert.equal(defaultModel.recorded.some(({ name }) => name === 'issues.subtasks'), false)
  model.dispose()
  defaultModel.dispose()
})

test('subtask preference writes serialize and failures restore the last saved value', async () => {
  const releases: (() => void)[] = []
  const writes: boolean[] = []
  const model = createModel({
    'connection.read': () => bound,
    'subtasks.preference.save': async input => { writes.push(input.enabled); await new Promise<void>(resolve => releases.push(resolve)); return { ok: true as const } },
  })
  await model.reload()
  model.toggleShowSubtasks()
  model.toggleShowSubtasks()
  assert.equal(model.state.showSubtasks, true)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(writes, [false])
  releases.shift()!()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(writes, [false, true])
  releases.shift()!()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(model.state.showSubtasks, true)
  model.dispose()

  const failed = createModel({ 'connection.read': () => bound, 'subtasks.preference.save': () => { throw Error('storage unavailable') } })
  await failed.reload()
  failed.toggleShowSubtasks()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(failed.state.showSubtasks, true)
  assert.equal(failed.state.problem, 'storage unavailable')
  failed.dispose()
})

test('connection read does not overwrite a user preference changed while it was pending', async () => {
  let resolveRead!: (value: ConnectionState) => void
  const model = createModel({
    'connection.read': () => new Promise<ConnectionState>(resolve => { resolveRead = resolve }),
    'subtasks.preference.save': () => ({ ok: true }),
  })
  const loading = model.reload()
  model.toggleShowSubtasks()
  resolveRead({ ...bound, showSubtasks: true })
  await loading
  assert.equal(model.state.showSubtasks, false)
  model.dispose()
})

test('subtask loads deduplicate, fail without retry loops, and retry explicitly', async () => {
  let calls = 0
  const model = createModel({
    'connection.read': () => bound,
    'issues.subtasks': () => { calls++; if (calls === 1) throw Error('temporary failure'); return [{ ...issues.items[0], id: '44' }] },
  })
  await model.reload()
  await Promise.all([model.loadSubtasks('42'), model.loadSubtasks('42')])
  assert.equal(calls, 1)
  assert.equal(model.state.subtasksErrors.has('42'), true)
  await model.loadSubtasks('42')
  assert.equal(calls, 1)
  await model.retrySubtasks('42')
  assert.equal(calls, 2)
  assert.equal(model.state.subtasks.get('42')?.[0].id, '44')
  model.dispose()
})

test('subtask requests stay within four concurrent parents', async () => {
  const releases: ((items: typeof issues.items) => void)[] = []
  let calls = 0
  const model = createModel({
    'connection.read': () => bound,
    'issues.subtasks': () => { calls++; return new Promise<typeof issues.items>(resolve => releases.push(resolve)) },
  })
  await model.reload()
  const pending = Array.from({ length: 6 }, (_, index) => model.loadSubtasks(String(50 + index)))
  assert.equal(calls, 4)
  releases.shift()!([])
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls, 5)
  for (const release of releases.splice(0)) release([])
  await new Promise(resolve => setTimeout(resolve, 0))
  for (const release of releases.splice(0)) release([])
  await Promise.all(pending)
  model.dispose()
})

test('refresh invalidates an in-flight subtask result and pagination remains independent', async () => {
  let release!: (items: typeof issues.items) => void
  let pageCalls = 0
  let updates = 0
  const model = createModel({
    'connection.read': () => bound,
    'issues.list': () => { pageCalls++; return pageCalls === 1 ? { items: issues.items, next: 'cursor-1' } : { items: [{ ...issues.items[1], id: '45' }], next: null } },
    'issues.subtasks': () => new Promise<typeof issues.items>(resolve => { release = resolve }),
  }, () => { updates++ })
  await model.reload()
  const pending = model.loadSubtasks('42')
  assert.equal(model.state.busy, false)
  await model.more()
  assert.deepEqual(model.state.issues.map(issue => issue.id), ['42', '43', '45'])
  const refresh = model.refresh()
  while (!release) await new Promise(resolve => setTimeout(resolve, 0))
  await refresh
  const settledUpdates = updates
  release([{ ...issues.items[0], id: '44' }])
  await pending
  assert.equal(model.state.subtasks.has('42'), false)
  assert.equal(updates, settledUpdates)
  model.dispose()
})

test('a same-project workspace switch keeps a task that is loading', async () => {
  let answer: (value: typeof detail) => void = () => {}
  const model = createModel({
    'connection.read': () => bound,
    'issues.detail': () => new Promise<typeof detail>(resolve => { answer = resolve }),
  })
  model.onWorkspace('worktree-a')
  await model.reload()
  const opened = model.openTask(detail.id)
  model.onWorkspace('worktree-b')
  answer(detail)
  await opened
  assert.equal(model.state.busy, false)
  assert.equal(model.state.detail?.id, detail.id)
  assert.equal(model.recorded.filter(({ name }) => name === 'issues.detail').length, 1)
  model.dispose()
})
