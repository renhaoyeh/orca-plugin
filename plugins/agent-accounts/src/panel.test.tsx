import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const state = { accounts: [{ id: 'a', label: 'Work', disabledReason: '' }], workspaceId: 'w', workspaceName: 'Demo', workspaceError: '' }

test('keeps the panel focused on account settings without duplicate launch or manage controls', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'accounts.locale': () => state } }) })
  assert.ok(view.find({ text: 'Agent Accounts' }))
  assert.equal(view.find({ text: 'Open Codex terminal' }), null)
  assert.equal(view.find({ text: 'Manage account' }), null)
  assert.equal(view.find({ label: 'Display name' }), null)
  assert.ok(view.find({ label: 'Edit name (Work)' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('account names remain editable without a workspace; closing the editor hides the form', async () => {
  const view = await mount(panel, { host: mockHost({ requests: {
    'accounts.locale': () => ({ ...state, workspaceId: null, workspaceError: '請先開啟一個工作區。' }),
  } }) })
  await view.press({ label: 'Edit name (Work)' })
  assert.ok(view.find({ label: 'Display name' }))
  await view.press({ label: 'Cancel editing (Work)' })
  assert.equal(view.find({ label: 'Display name' }), null)
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('terminal rename events keep the account list stable; a real workspace switch reloads it', async () => {
  let reads = 0
  let current = state
  const host = mockHost({ capabilities: ['workspace:read'], requests: {
    'accounts.locale': () => { reads++; return current },
  } })
  const view = await mount(panel, { host })
  const initialReads = reads
  for (const title of ['Working', 'Working…', 'Ready']) {
    await view.emit('workspace.changed', { context: { workspaceId: 'w', branch: 'main', displayName: 'Demo', terminals: [{ id: 't', title }] } })
    assert.ok(view.find({ label: 'Edit name (Work)' }))
    assert.equal(view.find({ label: 'Loading accounts' }), null)
  }
  assert.equal(reads, initialReads)
  current = { ...state, workspaceId: 'w2', workspaceName: 'Other' }
  await view.emit('workspace.changed', { context: { workspaceId: 'w2', branch: 'main', displayName: 'Other', terminals: [] } })
  assert.equal(reads, initialReads + 1)
  assert.ok(view.find({ label: 'Edit name (Work)' }))
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('saves a custom display name from the account form', async () => {
  let saved: unknown
  const view = await mount(panel, { host: mockHost({ requests: {
    'accounts.locale': () => state,
    'accounts.rename': input => {
      saved = input
      return { ...state, accounts: [{ ...state.accounts[0], label: input.name, identityLabel: 'Work' }] }
    },
  } }) })
  await view.press({ label: 'Edit name (Work)' })
  await view.type({ label: 'Display name' }, '公司')
  await view.press({ text: 'Save name' })
  assert.deepEqual(saved, { accountId: 'a', name: '公司' })
  assert.ok(view.find({ text: 'Display name saved.' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('follows Orca locale without a separate language selector', async () => {
  for (const [locale, button] of [['en', 'Edit name'], ['zh-TW', '編輯名稱'], ['zh-CN', '编辑名称'], ['fr', 'Edit name']]) {
    const view = await mount(panel, { locale, host: mockHost({ requests: { 'accounts.locale': () => state } }) })
    assert.ok(view.find({ label: `${button} (Work)` }))
    assert.equal(view.find({ label: 'Language' }), null)
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
    await view.unmount()
  }
})

test('omits API key creation and permission help in every supported locale', async () => {
  for (const locale of ['en', 'zh-TW', 'zh-CN']) {
    const view = await mount(panel, { locale, host: mockHost({ requests: { 'accounts.locale': () => state } }) })
    assert.equal(view.find({ type: 'Collapsible' }), null)
    assert.equal(view.find({ label: 'OpenAI API key' }), null)
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
    await view.unmount()
  }
})

test('existing API profiles stay visible and removable without a key entry form', async () => {
  let removed: unknown
  const view = await mount(panel, { host: mockHost({ requests: {
    'accounts.locale': () => ({ ...state, accounts: [{ id: 'api', label: 'Existing API', kind: 'api', disabledReason: '' }] }),
    'accounts.api.remove': input => { removed = input; return { ...state, accounts: [] } },
  } }) })
  assert.ok(view.find({ text: 'Existing API' }))
  await view.press({ label: 'Edit name (Existing API)' })
  await view.press({ text: 'Remove API profile' })
  assert.deepEqual(removed, { accountId: 'api' })
  assert.ok(view.find({ text: 'API profile removed. Existing terminals are unchanged.' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
