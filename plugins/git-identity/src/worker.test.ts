import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker'
import { identity } from './fixtures'
const routing = { readPushBinding: async () => null, savePushBinding: async () => identity }
const results = {
  'workspace.readContext': { workspaceId: 'w', branch: 'main', displayName: 'Demo', terminals: [] },
  'workspace.list': { workspaces: [{ id: 'w', kind: 'folder', name: 'Demo', path: 'C:\\demo', branch: null, hostId: 'local' }], truncated: false },
}
test('the command opens only the panel, without writing Git config', async () => {
  let opens = 0, saves = 0
  const host = mockHost({ capabilities: ['workspace:read'], results })
  const worker = await mountWorker({ default: createWorker({ readIdentity: async () => identity, saveIdentity: async () => { saves++; return identity }, openPanel: async () => { opens++ } }, undefined, routing) }, { host })
  await worker.command('identity.open')
  assert.equal(opens, 1); assert.equal(saves, 0)
  await assert.rejects(worker.request('identity.save', { workspaceId: 'other', repoPath: identity.repoPath, revision: 'demo', name: 'Draft', email: identity.email }), /Workspace changed/)
  assert.equal(saves, 0)
  await worker.request('identity.save', { workspaceId: 'w', repoPath: identity.repoPath, revision: 'demo', name: 'Draft', email: identity.email })
  assert.equal(saves, 1)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
test('remote workspaces never execute local Git', async () => {
  let reads = 0
  const host = mockHost({ capabilities: ['workspace:read'], results: { ...results, 'workspace.list': { workspaces: [{ ...results['workspace.list'].workspaces[0], hostId: 'ssh:remote' }], truncated: false } } })
  const worker = await mountWorker({ default: createWorker({ readIdentity: async () => { reads++; return identity }, saveIdentity: async () => identity, openPanel: async () => {} }) }, { host })
  const state = await worker.request('identity.read')
  assert.equal(state.identity, null); assert.equal(reads, 0)
  assert.ok(state.problem.includes('local Windows'))
  await worker.deactivate()
})
