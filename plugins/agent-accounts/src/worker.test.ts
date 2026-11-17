import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker'
import type { OrcaWorkerApi } from 'orca/worker'

const account = { id: 'a', label: 'Work', home: 'C:\\fake-account', disabledReason: '' }
const results = {
  'workspace.readContext': { workspaceId: 'w', branch: 'main', displayName: 'Demo', terminals: [] },
  'workspace.list': { workspaces: [{ id: 'w', kind: 'folder', name: 'Demo', path: 'C:\\demo', branch: null, hostId: 'local' }], truncated: false },
  'terminal.create': { terminalId: 't' },
}
let created: unknown[] = []
const deps = { listAccounts: async () => [account], createTerminal: async (workspace: string, selected: typeof account) => {
  created.push({ workspace, selected })
  return { terminalId: 't' }
} }

test('registers status commands before asynchronous name storage finishes loading', async () => {
  const commands: string[] = []
  let finish!: (value: null) => void
  const saved = new Promise<null>(resolve => { finish = resolve })
  const api = {
    storage: { get: () => saved },
    commands: { register: (id: string) => commands.push(id) },
    panels: { handle: () => {} }, events: { on: () => {} }, log: () => {},
    host: { call: async (method: string) => method === 'workspace.readContext' ? null : { ok: true } },
  } as unknown as OrcaWorkerApi
  const activation = createWorker(deps)(api)
  assert.equal(commands.length, 8)
  finish(null)
  await activation
})

test('launches exactly the selected account in the captured workspace without switching accounts', async () => {
  created = []
  const host = mockHost({ capabilities: ['workspace:read', 'terminal:send', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker(deps) }, { host })
  const state = await worker.request('accounts.list')
  assert.equal(state.workspaceId, 'w')
  assert.equal('home' in state.accounts[0], false)
  assert.deepEqual(await worker.request('accounts.launch', { accountId: 'a', workspaceId: 'w' }), { terminalId: 't' })
  assert.deepEqual(created, [{ workspace: 'w', selected: account }])
  await assert.rejects(worker.request('accounts.launch', { accountId: 'missing', workspaceId: 'w' }))
  await assert.rejects(worker.request('accounts.launch', { accountId: 'a', workspaceId: 'changed' }))
  assert.equal(created.length, 1)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('refuses remote workspaces and unavailable accounts before creating any terminal', async () => {
  created = []
  const host = mockHost({ capabilities: ['workspace:read', 'terminal:send', 'storage:own'], results: {
    ...results, 'workspace.list': { workspaces: [{ ...results['workspace.list'].workspaces[0], hostId: 'ssh:demo' }], truncated: false },
  } })
  const worker = await mountWorker({ default: createWorker(deps) }, { host })
  assert.equal((await worker.request('accounts.list')).workspaceId, null)
  await assert.rejects(worker.request('accounts.launch', { accountId: 'a', workspaceId: 'w' }))
  host.respond('workspace.list', results['workspace.list'])
  const blocked = await mountWorker({ default: createWorker({ ...deps, listAccounts: async () => [{ ...account, disabledReason: 'Signed out' }] }) }, { host })
  await assert.rejects(blocked.request('accounts.launch', { accountId: 'a', workspaceId: 'w' }))
  assert.equal(host.callsOf('terminal.create').length, 0)
  assert.equal(created.length, 0)
  await worker.deactivate()
  await blocked.deactivate()
})

test('flattens accounts into status buttons and launches the displayed id after the list reorders', async () => {
  created = []
  const second = { ...account, id: 'b', label: 'Personal', home: 'C:\\other-account' }
  let accounts = [account, second]
  const host = mockHost({ capabilities: ['workspace:read', 'terminal:send', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker({ ...deps, listAccounts: async () => accounts }) }, { host })
  const updates = host.callsOf('statusBar.update') as { id: string; text: string; visible: boolean }[]
  assert.deepEqual(updates.filter(item => item.visible).map(item => item.text), ['Work', 'Personal'])
  assert.equal(updates.filter(item => !item.visible).length, 6)
  accounts = [second, account]
  await worker.command('accounts.open1')
  assert.deepEqual(created, [{ workspace: 'w', selected: account }])
  accounts = [second]
  await assert.rejects(worker.command('accounts.open2'))
  assert.equal(created.length, 1)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('persists account names by id, updates icon buttons, restores defaults and rejects invalid names', async () => {
  const host = mockHost({ capabilities: ['workspace:read', 'terminal:send', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker(deps) }, { host })
  const renamed = await worker.request('accounts.rename', { accountId: 'a', name: ' 公司 ' })
  assert.equal(renamed.accounts[0].label, '公司')
  assert.equal(renamed.accounts[0].identityLabel, 'Work')
  assert.deepEqual(host.data().storage['display-names'], { a: '公司' })
  const updates = host.callsOf('statusBar.update') as { id: string; icon: string; text: string }[]
  assert.equal(updates.filter(item => item.id === 'account-1').at(-1)?.icon, 'terminal')
  assert.equal(updates.filter(item => item.id === 'account-1').at(-1)?.text, '公司')
  await assert.rejects(worker.request('accounts.rename', { accountId: 'a', name: 'x'.repeat(41) }))
  await assert.rejects(worker.request('accounts.rename', { accountId: 'missing', name: 'Other' }))
  await worker.deactivate()
  const restarted = await mountWorker({ default: createWorker(deps) }, { host })
  assert.equal((await restarted.request('accounts.list')).accounts[0].label, '公司')
  assert.equal((await restarted.request('accounts.rename', { accountId: 'a', name: '' })).accounts[0].label, 'Work')
  assert.deepEqual(host.data().storage['display-names'], {})
  await restarted.deactivate()
})

test('remembers the Orca locale for status tooltips after restart', async () => {
  const host = mockHost({ capabilities: ['workspace:read', 'terminal:send', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker(deps) }, { host })
  assert.equal((await worker.request('accounts.list')).language, 'en')
  assert.equal((await worker.request('accounts.locale', { locale: 'zh-CN' })).language, 'zh-CN')
  assert.equal(host.data().storage['orca-locale'], 'zh-CN')
  await worker.deactivate()
  const restarted = await mountWorker({ default: createWorker(deps) }, { host })
  assert.equal((await restarted.request('accounts.list')).language, 'zh-CN')
  const updates = host.callsOf('statusBar.update') as { tooltip: string }[]
  assert.ok(updates.some(item => item.tooltip === '使用 Work 打开 Codex 终端'))
  await restarted.deactivate()
})

test('keeps API keys in secrets only, routes API launches separately and removes saved keys', async () => {
  const fakeKey = 'sk-test-not-a-real-key'
  let launched: unknown
  const host = mockHost({ capabilities: ['workspace:read', 'terminal:send', 'storage:own', 'secrets:own'], results: {
    ...results, 'secrets.protection': { status: 'os-keyring' },
  } })
  const apiDeps = {
    newApiProfile: (name: string) => ({ id: 'api-11111111-1111-1111-1111-111111111111', name }),
    createApiTerminal: async (workspace: string, profile: unknown, key: string) => { launched = { workspace, profile, key }; return { terminalId: 'api-terminal' } },
  }
  const worker = await mountWorker({ default: createWorker(deps, apiDeps) }, { host })
  const saved = await worker.request('accounts.api.add', { name: 'Paid API', key: fakeKey })
  const api = saved.accounts.find(item => item.kind === 'api')!
  assert.equal(api.label, 'Paid API · API')
  assert.equal(JSON.stringify(saved).includes(fakeKey), false)
  assert.equal(JSON.stringify(host.data().storage).includes(fakeKey), false)
  assert.equal(host.data().secrets[api.id], fakeKey)
  assert.deepEqual(await worker.request('accounts.launch', { accountId: api.id, workspaceId: 'w' }), { terminalId: 'api-terminal' })
  assert.deepEqual(launched, { workspace: 'w', profile: { id: api.id, name: 'Paid API' }, key: fakeKey })
  assert.equal(JSON.stringify(worker.logs).includes(fakeKey), false)
  await worker.request('accounts.api.remove', { accountId: api.id })
  assert.equal(host.data().secrets[api.id], undefined)
  assert.deepEqual(host.data().storage['api-profiles'], [])
  await worker.deactivate()
})

test('refuses to save API credentials without encrypted OS storage', async () => {
  const host = mockHost({ capabilities: ['workspace:read', 'terminal:send', 'storage:own', 'secrets:own'], results: {
    ...results, 'secrets.protection': { status: 'unavailable' },
  } })
  const worker = await mountWorker({ default: createWorker(deps) }, { host })
  await assert.rejects(worker.request('accounts.api.add', { name: 'API', key: 'sk-test-not-a-real-key' }), /Encrypted/)
  assert.deepEqual(host.data().secrets, {})
  assert.equal(host.data().storage['api-profiles'], undefined)
  await worker.deactivate()
})
