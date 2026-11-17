import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker'
const fake = { subtasks: async () => [], validate: async () => { throw Error('Saving must not contact the offline server') }, projects: async () => ({ items: [], next: null }), issues: async () => ({ items: [], next: null }), detail: async () => ({}), projectInfo: async (id: string) => ({ id, name: 'MantisBT project', workspaceId: id }) }
const input = { url: 'https://mantis.example.test', token: 'test-only-token' }
const capabilities = ['secrets:own', 'storage:own', 'workspace:read']
test('offline settings save only to encrypted secrets and never return the token', async () => {
  const host = mockHost({ capabilities })
  const worker = await mountWorker({ default: createWorker(() => fake, async () => 'repo-a') }, { host })
  const result = await worker.request('connection.save', input)
  assert.equal(result.configured, true); assert.ok(!JSON.stringify(result).includes(input.token))
  assert.equal(JSON.parse(host.data().secrets['connection.v1'] as string).token, input.token)
  assert.deepEqual(host.data().storage, {})
  await worker.request('connection.remove')
  assert.equal((await worker.request('connection.read')).configured, false)
  await assert.rejects(worker.request('issues.list', { project: '12', cursor: null }), /Connect/)
  assert.deepEqual(worker.refusals, []); await worker.deactivate()
})
test('bindings restore per workspace and server, with stale writes rejected', async () => {
  let repo = 'repo-a'
  const host = mockHost({ capabilities, secrets: { 'connection.v1': JSON.stringify(input) } })
  const worker = await mountWorker({ default: createWorker(() => fake, async () => repo) }, { host })
  const first = await worker.request('connection.read')
  await worker.request('project.bind', { id: '12', scope: first.scope! })
  repo = 'repo-b'
  const second = await worker.request('connection.read')
  assert.equal(second.binding, null)
  await assert.rejects(worker.request('project.bind', { id: '13', scope: first.scope! }), /Workspace or server changed/)
  await worker.request('project.bind', { id: '13', scope: second.scope! })
  repo = 'repo-a'
  assert.equal((await worker.request('connection.read')).binding?.id, '12')
  await worker.request('connection.save', { ...input, url: 'https://other.example.test' })
  assert.equal((await worker.request('connection.read')).binding, null)
  await worker.request('connection.save', input)
  assert.equal((await worker.request('connection.read')).binding?.id, '12')
  await worker.deactivate()
})
test('invalid input and changed-server blank tokens preserve prior credentials; view preference persists', async () => {
  const host = mockHost({ capabilities, secrets: { 'connection.v1': JSON.stringify(input) } })
  const worker = await mountWorker({ default: createWorker(() => fake, async () => 'repo-a') }, { host })
  await assert.rejects(worker.request('connection.save', { ...input, token: 'bad\nheader' }), /valid API token/)
  await assert.rejects(worker.request('connection.save', { url: 'https://other.example.test', token: '' }), /valid API token/)
  assert.equal(host.data().secrets['connection.v1'], JSON.stringify(input))
  await worker.request('view.save', { tab: 'all' })
  assert.equal((await worker.request('connection.read')).tab, 'all')
  await worker.deactivate()
})
