import { assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import { createWorker } from './worker'
import * as panel from './panel'

const account = { id: 'work', label: 'Work', home: 'C:\\fake', disabledReason: '' }
const results = {
  'workspace.readContext': { workspaceId: 'w', branch: 'main', displayName: 'Demo', terminals: [] },
  'workspace.list': { workspaces: [{ id: 'w', kind: 'folder', name: 'Demo', path: 'C:\\demo', branch: null, hostId: 'local' }], truncated: false },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

for (const provider of ['codex', 'claude', 'pi']) {
  test(`${provider}: rapid clicks while opening are ignored, not errors or queued launches`, async () => {
    const entered = deferred<void>(), finish = deferred<void>()
    let launches = 0
    const start = async () => { launches++; entered.resolve(); await finish.promise }
    const host = mockHost({ capabilities: ['workspace:read', 'storage:own'], results })
    const worker = await mountWorker({ default: createWorker({
      listAccounts: async () => [
        ...(provider === 'pi' ? [] : [{ ...account, provider }]),
        { ...account, id: 'other', label: 'Other' },
      ],
      createTerminal: async () => { await start(); return { terminalId: 'terminal' } },
    }, undefined, undefined, {
      launchPi: async () => { await start(); return { accepted: true } },
    }) }, { host })
    if (provider === 'pi') await worker.request('accounts.pi.add')
    const command = provider === 'pi' ? 'accounts.open2' : 'accounts.open1'
    const otherCommand = provider === 'pi' ? 'accounts.open1' : 'accounts.open2'
    const first = worker.command(command)
    await entered.promise
    const repeated = await Promise.all(Array.from({ length: 12 }, () => worker.command(command)))
    for (const result of repeated) assert.deepEqual(result, { pending: true })
    assert.deepEqual(await worker.command(otherCommand), { pending: true })
    assert.deepEqual(await worker.request('accounts.launch', { accountId: 'other', workspaceId: 'w' }), { pending: true })
    assert.deepEqual(await worker.request('accounts.add', { provider: 'claude', workspaceId: 'w' }), { pending: true })
    assert.equal(launches, 1)
    assert.deepEqual(worker.logs, [])
    finish.resolve()
    await first
    assert.equal(launches, 1) // Nothing was queued by those clicks.
    await worker.command(command)
    assert.equal(launches, 2) // A deliberate click after completion works again.
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  })
}

test('the launch lock covers slow account lookup before terminal creation', async () => {
  const entered = deferred<void>(), finish = deferred<void>()
  let holdLookup = false, launches = 0, reads = 0
  const host = mockHost({ capabilities: ['workspace:read', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker({
    listAccounts: async () => {
      reads++
      if (holdLookup) { entered.resolve(); await finish.promise }
      return [account]
    },
    createTerminal: async () => { launches++; return { terminalId: 't' } },
  }) }, { host })
  holdLookup = true
  const first = worker.command('accounts.open1')
  await entered.promise
  const before = reads
  assert.deepEqual(await worker.command('accounts.open1'), { pending: true })
  assert.equal(reads, before)
  assert.equal(launches, 0)
  finish.resolve()
  await first
  assert.equal(launches, 1)
  assert.deepEqual(worker.logs, [])
  await worker.deactivate()
})

test('real launch failures still surface and release the lock for a retry', async () => {
  const entered = deferred<void>(), finish = deferred<void>()
  let launches = 0
  const host = mockHost({ capabilities: ['workspace:read', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker({
    listAccounts: async () => [account],
    createTerminal: async () => {
      launches++
      if (launches === 1) { entered.resolve(); await finish.promise }
      return { terminalId: 't' }
    },
  }) }, { host })
  const first = worker.command('accounts.open1')
  const rejected = assert.rejects(first, /Actual launch failure/)
  await entered.promise
  assert.deepEqual(await worker.command('accounts.open1'), { pending: true })
  finish.reject(Error('Actual launch failure'))
  await rejected
  await worker.command('accounts.open1')
  assert.equal(launches, 2)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a pending sign-in terminal also blocks status clicks without an error', async () => {
  const entered = deferred<void>(), finish = deferred<void>()
  let launches = 0, signIns = 0
  const host = mockHost({ capabilities: ['workspace:read', 'storage:own'], results })
  const worker = await mountWorker({ default: createWorker({
    listAccounts: async () => [account],
    createTerminal: async () => { launches++; return { terminalId: 't' } },
  }, undefined, {
    createLoginTerminal: async () => { signIns++; entered.resolve(); await finish.promise; return { terminalId: 'login' } },
  }) }, { host })
  const first = worker.request('accounts.add', { provider: 'codex', workspaceId: 'w' })
  await entered.promise
  assert.deepEqual(await worker.command('accounts.open1'), { pending: true })
  assert.deepEqual(await worker.request('accounts.add', { provider: 'claude', workspaceId: 'w' }), { pending: true })
  assert.equal(signIns, 1)
  assert.equal(launches, 0)
  finish.resolve()
  await first
  await worker.command('accounts.open1')
  assert.equal(launches, 1)
  assert.deepEqual(worker.logs, [])
  await worker.deactivate()
})

test('panel shows a waiting notice instead of falsely claiming a duplicate login opened', async () => {
  const view = await mount(panel, { host: mockHost({ requests: {
    'accounts.locale': () => ({ accounts: [], workspaceId: 'w', workspaceName: 'Demo', workspaceError: '' }),
    'accounts.add': () => ({ pending: true }),
  } }) })
  await view.press({ text: 'Add Codex' })
  assert.ok(view.find({ text: 'An agent is opening. Please wait.' }))
  assert.equal(view.find({ text: 'Sign-in terminal opened. Refresh the account list after signing in.' }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
