import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker'
import { detail as exampleDetail } from './fixtures'
const fake = { subtasks: async () => [], validate: async () => { throw Error('Original Asana token save does not validate over the network') }, projects: async () => ({ items: [], next: null }), issues: async () => ({ items: [], next: null }), detail: async () => exampleDetail, projectInfo: async (id: string) => ({ id, name: 'Asana project', workspaceId: '1' }) }
const input = { url: '', token: 'test-only-token' }
const capabilities = ['secrets:own', 'storage:own']
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
