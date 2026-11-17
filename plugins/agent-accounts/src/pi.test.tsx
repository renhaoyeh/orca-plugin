import { assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import * as panel from './panel'
import { createWorker } from './worker'

const pi = { id: 'pi-default', label: 'Pi', identityLabel: 'Pi', disabledReason: '', provider: 'pi' }
const state = { accounts: [], workspaceId: 'w', workspaceName: 'Demo', workspaceError: '' }
const results = {
  'workspace.readContext': { workspaceId: 'w', branch: 'main', displayName: 'Demo', terminals: [] },
  'workspace.list': { workspaces: [{ id: 'w', kind: 'folder', name: 'Demo', path: 'C:\\demo', branch: null, hostId: 'local' }], truncated: false },
}

test('Add Pi adds a list entry without launching, follows locale and prevents duplicates', async () => {
  for (const [locale, button] of [['en', 'Add Pi'], ['zh-TW', '新增 Pi'], ['zh-CN', '添加 Pi']]) {
    let adds = 0, launches = 0
    const view = await mount(panel, { locale, host: mockHost({ requests: {
      'accounts.locale': () => state,
      'accounts.pi.add': () => { adds++; return { ...state, accounts: [pi] } },
      'accounts.launch': () => { launches++; return { accepted: true } },
    } }) })
    assert.equal(adds, 0)
    assert.equal(view.find({ text: 'Open Pi' }), null)
    await view.press({ text: button })
    assert.equal(adds, 1)
    assert.equal(launches, 0)
    assert.ok(view.find({ text: 'Pi' }))
    assert.equal(view.find({ text: button })?.props.disabled, true)
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
    await view.unmount()
  }
})

test('Add Pi works without a workspace, reports save errors and can remove the saved entry', async () => {
  const unavailable = await mount(panel, { host: mockHost({ requests: {
    'accounts.locale': () => ({ ...state, workspaceId: null }),
    'accounts.pi.add': () => { throw Error('Storage unavailable') },
  } }) })
  assert.equal(unavailable.find({ text: 'Add Pi' })?.props.disabled, false)
  await unavailable.press({ text: 'Add Pi' })
  assert.ok(unavailable.find({ text: /Storage unavailable/ }))
  assert.equal(unavailable.find({ text: 'Pi' }), null)
  await unavailable.unmount()

  let removes = 0
  const view = await mount(panel, { host: mockHost({ requests: {
    'accounts.locale': () => ({ ...state, accounts: [pi] }),
    'accounts.pi.remove': () => { removes++; return state },
  } }) })
  await view.press({ label: 'Edit name (Pi)' })
  await view.press({ text: 'Remove Pi entry' })
  assert.equal(removes, 1)
  assert.equal(view.find({ text: 'Pi' }), null)
  assert.equal(view.find({ text: 'Add Pi' })?.props.disabled, false)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Pi persists in the list and status bar; only clicking its status command launches it', async () => {
  const launched: string[] = []
  const host = mockHost({ capabilities: ['workspace:read', 'storage:own'], results })
  const module = { default: createWorker({ listAccounts: async () => [], createTerminal: async () => { throw Error('Must not launch Codex') } }, undefined, undefined, {
    launchPi: async workspaceId => { launched.push(workspaceId); return { accepted: true } },
  }) }
  const worker = await mountWorker(module, { host })
  assert.equal((await worker.request('accounts.list')).accounts.length, 0)
  assert.equal((await worker.request('accounts.pi.add')).accounts.length, 1)
  assert.equal((await worker.request('accounts.pi.add')).accounts.length, 1)
  assert.equal(host.data().storage['pi-enabled'], true)
  assert.deepEqual(launched, [])
  const updates = host.callsOf('statusBar.update') as { id: string; text: string; visible: boolean; tooltip: string; icon: string }[]
  assert.ok(updates.some(item => item.visible && item.text === 'Pi' && item.icon === 'bot' && item.tooltip === 'Open a Pi chat as Pi'))
  await worker.deactivate()

  const restarted = await mountWorker(module, { host })
  assert.equal((await restarted.request('accounts.list')).accounts[0].provider, 'pi')
  assert.deepEqual(launched, [])
  await restarted.command('accounts.open1')
  assert.deepEqual(launched, ['w'])
  const renamed = await restarted.request('accounts.rename', { accountId: pi.id, name: 'My Pi' })
  assert.equal(renamed.accounts[0].label, 'My Pi')
  const removed = await restarted.request('accounts.pi.remove')
  assert.equal(removed.accounts.length, 0)
  assert.equal(host.data().storage['pi-enabled'], false)
  const afterRemoval = host.callsOf('statusBar.update') as { id: string; visible: boolean }[]
  assert.equal(afterRemoval.filter(item => item.id === 'account-1').at(-1)?.visible, false)
  await assert.rejects(restarted.request('accounts.launch', { accountId: pi.id, workspaceId: 'w' }))
  assert.deepEqual(launched, ['w'])
  assert.deepEqual(restarted.refusals, [])
  await restarted.deactivate()
})

test('worker refuses Pi launch in remote or changed workspaces', async () => {
  const received: string[] = []
  const host = mockHost({ capabilities: ['workspace:read', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker({ listAccounts: async () => [], createTerminal: async () => ({ terminalId: 'unused' }) }, undefined, undefined, {
    launchPi: async workspaceId => { received.push(workspaceId); return { accepted: true } },
  }) }, { host })
  await worker.request('accounts.pi.add')
  await assert.rejects(worker.request('accounts.launch', { accountId: pi.id, workspaceId: 'other' }))
  host.respond('workspace.list', { workspaces: [{ ...results['workspace.list'].workspaces[0], hostId: 'ssh:remote' }], truncated: false })
  await assert.rejects(worker.request('accounts.launch', { accountId: pi.id, workspaceId: 'w' }))
  assert.deepEqual(received, [])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('Pi gets a status slot even when there are already eight managed accounts', async () => {
  const host = mockHost({ capabilities: ['workspace:read', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker({
    listAccounts: async () => Array.from({ length: 8 }, (_, index) => ({ id: `account-${index}`, label: `Account ${index}`, home: 'C:\\fake', disabledReason: '' })),
    createTerminal: async () => ({ terminalId: 'unused' }),
  }) }, { host })
  assert.equal((await worker.request('accounts.pi.add')).accounts.length, 9)
  const updates = host.callsOf('statusBar.update') as { id: string; text: string; visible: boolean }[]
  const latest = new Map(updates.map(item => [item.id, item]))
  assert.equal([...latest.values()].filter(item => item.visible).length, 8)
  assert.equal(latest.get('account-8')?.text, 'Pi')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
