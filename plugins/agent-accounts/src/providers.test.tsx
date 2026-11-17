import { assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import * as panel from './panel'
import { createWorker } from './worker'

const account = { id: 'claude-work', label: 'Claude work', home: 'C:\\fake', disabledReason: '', provider: 'claude' }
const state = { accounts: [account], workspaceId: 'w', workspaceName: 'Demo', workspaceError: '' }

test('panel shows Claude and starts either provider login only on click', async () => {
  const received: unknown[] = []
  const view = await mount(panel, { host: mockHost({ requests: {
    'accounts.locale': () => state,
    'accounts.add': input => { received.push(input); return { terminalId: 'login' } },
  } }) })
  assert.equal(received.length, 0)
  assert.ok(view.find({ text: 'Claude' }))
  for (const provider of ['Codex', 'Claude']) await view.press({ text: `Add ${provider}` })
  assert.deepEqual(received, [{ provider: 'codex', workspaceId: 'w' }, { provider: 'claude', workspaceId: 'w' }])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('worker keeps Claude provider on launch and validates workspace before login', async () => {
  const logins: unknown[] = [], launches: unknown[] = []
  const host = mockHost({ capabilities: ['workspace:read', 'terminal:send', 'storage:own'], results: {
    'workspace.readContext': { workspaceId: 'w', branch: 'main', displayName: 'Demo', terminals: [] },
    'workspace.list': { workspaces: [{ id: 'w', kind: 'folder', name: 'Demo', path: 'C:\\demo', branch: null, hostId: 'local' }], truncated: false },
  } })
  const worker = await mountWorker({ default: createWorker({ listAccounts: async () => [account], createTerminal: async (workspace, selected) => {
    launches.push({ workspace, selected }); return { terminalId: 'claude' }
  } }, undefined, { createLoginTerminal: async (workspace, provider) => {
    logins.push({ workspace, provider }); return { terminalId: 'login' }
  } }) }, { host })
  assert.equal((await worker.request('accounts.list')).accounts[0].provider, 'claude')
  await worker.request('accounts.launch', { accountId: account.id, workspaceId: 'w' })
  assert.deepEqual(launches, [{ workspace: 'w', selected: account }])
  await worker.request('accounts.add', { provider: 'claude', workspaceId: 'w' })
  await assert.rejects(worker.request('accounts.add', { provider: 'codex', workspaceId: 'other' }))
  host.respond('workspace.list', { workspaces: [{ id: 'w', kind: 'folder', name: 'Remote', path: 'C:\\demo', branch: null, hostId: 'ssh:remote' }], truncated: false })
  await assert.rejects(worker.request('accounts.add', { provider: 'claude', workspaceId: 'w' }))
  assert.deepEqual(logins, [{ workspace: 'w', provider: 'claude' }])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
