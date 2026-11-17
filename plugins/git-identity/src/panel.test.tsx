import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { state } from './fixtures'

test('keeps technical sources out of the panel and saves an explicit author edit', async () => {
  let saved: unknown
  const view = await mount(panel, { host: mockHost({ requests: {
    'identity.read': () => state,
    'identity.save': input => { saved = input; return { ...state, identity: { ...state.identity, name: input.name, email: input.email } } },
  } }) })
  assert.equal(saved, undefined)
  for (const text of ['demo', state.workspaceName, 'global', 'local', 'Current source', 'Remove binding', 'Use for push', state.identity.repoPath, state.identity.nameSource.origin, state.identity.emailSource.origin]) assert.equal(view.find({ text }), null)
  assert.equal(view.valueOf({ label: 'GitHub account' }), 'default')
  assert.equal(view.find({ text: 'Save' })?.props.disabled, true)
  await view.type({ label: 'Name' }, 'Edited Author', { replace: true })
  await view.press({ text: 'Save' })
  assert.deepEqual(saved, { workspaceId: 'w', repoPath: state.identity.repoPath, revision: 'demo', name: 'Edited Author', email: state.identity.email })
  assert.ok(view.find({ text: 'Saved.' }))
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('choosing an account switches its binding immediately but private author email must be entered explicitly', async () => {
  let saves = 0
  const view = await mount(panel, { host: mockHost({ requests: {
    'identity.read': () => state,
    'github.accounts': () => [{ host: 'github.com', login: 'work', available: true }],
    'github.author': input => { assert.equal(input.login, 'work'); return { name: 'Work Profile', email: '' } },
    'github.bind': () => ({ ...state, pushBinding: { host: 'github.com', login: 'work', managed: true } }),
    'identity.save': () => { saves++; return state },
  } }) })
  await view.select({ label: 'GitHub account' }, JSON.stringify(['github.com', 'work']))
  assert.equal(view.valueOf({ label: 'Name' }), 'Work Profile')
  assert.equal(view.valueOf({ label: 'Email' }), '')
  assert.equal(view.find({ text: 'Save' })?.props.disabled, true)
  assert.equal(saves, 0)
  assert.ok(view.find({ text: /No public email/ }))
  await view.unmount()
})

test('account selection immediately switches the repo default and author save uses the updated revision', async () => {
  let bindings = 0, saves = 0
  const view = await mount(panel, { host: mockHost({ requests: {
    'identity.read': () => state,
    'github.accounts': () => [{ host: 'github.com', login: 'work', available: true }],
    'github.author': () => ({ name: 'Work Author', email: 'work@example.test' }),
    'github.bind': input => {
      bindings++
      assert.deepEqual(input, { workspaceId: 'w', repoPath: state.identity.repoPath, revision: 'demo', account: { host: 'github.com', login: 'work' } })
      return { ...state, identity: { ...state.identity, revision: 'new-revision' }, pushBinding: { host: 'github.com', login: 'work', managed: true } }
    },
    'identity.save': input => {
      saves++; assert.equal(input.revision, 'new-revision'); assert.equal(input.name, 'Work Author')
      return { ...state, identity: { ...state.identity, name: input.name, email: input.email } }
    },
  } }) })
  await view.select({ label: 'GitHub account' }, JSON.stringify(['github.com', 'work']))
  assert.equal(bindings, 1); assert.equal(saves, 0)
  assert.equal(view.find({ text: 'Use for push' }), null)
  assert.equal(view.valueOf({ label: 'Name' }), 'Work Author')
  assert.equal(view.valueOf({ label: 'GitHub account' }), JSON.stringify(['github.com', 'work']))
  await view.press({ text: 'Save' })
  assert.equal(saves, 1)
  await view.unmount()
})

test('opening and refreshing show the stored account without reapplying its binding', async () => {
  let bindings = 0
  const key = JSON.stringify(['github.com', 'work'])
  const view = await mount(panel, { host: mockHost({ requests: {
    'identity.read': () => ({ ...state, pushBinding: { host: 'github.com', login: 'work', managed: true } }),
    'github.accounts': () => [{ host: 'github.com', login: 'work', available: true }],
    'github.bind': () => { bindings++; return state },
  } }) })
  assert.equal(view.valueOf({ label: 'GitHub account' }), key)
  await view.press({ label: 'Refresh identity' })
  assert.equal(view.valueOf({ label: 'GitHub account' }), key)
  assert.equal(bindings, 0)
  await view.unmount()
})

test('failed switches restore the prior selection and do not replace author edits', async () => {
  const key = JSON.stringify(['github.com', 'old'])
  const view = await mount(panel, { host: mockHost({ requests: {
    'identity.read': () => ({ ...state, pushBinding: { host: 'github.com', login: 'old', managed: true } }),
    'github.accounts': () => [{ host: 'github.com', login: 'old', available: true }, { host: 'github.com', login: 'work', available: true }],
    'github.bind': () => { throw Error('Git config locked') },
    'github.author': () => { throw Error('Must not load profile after failed switch') },
  } }) })
  await view.type({ label: 'Name' }, 'My Draft', { replace: true })
  await view.select({ label: 'GitHub account' }, JSON.stringify(['github.com', 'work']))
  assert.equal(view.valueOf({ label: 'GitHub account' }), key)
  assert.equal(view.valueOf({ label: 'Name' }), 'My Draft')
  assert.ok(view.find({ text: /Git config locked/ }))
  await view.unmount()
})

test('profile failures do not undo an already successful default-account switch', async () => {
  const key = JSON.stringify(['github.com', 'work'])
  const view = await mount(panel, { host: mockHost({ requests: {
    'identity.read': () => state,
    'github.accounts': () => [{ host: 'github.com', login: 'work', available: true }],
    'github.bind': () => ({ ...state, pushBinding: { host: 'github.com', login: 'work', managed: true } }),
    'github.author': () => { throw Error('Profile unavailable') },
  } }) })
  await view.select({ label: 'GitHub account' }, key)
  assert.equal(view.valueOf({ label: 'GitHub account' }), key)
  assert.ok(view.find({ text: /Account switched, but the profile could not be loaded/ }))
  assert.equal(view.valueOf({ label: 'Name' }), state.identity.name)
  await view.unmount()
})

test('Default in the account picker restores previous Git settings without a separate remove button', async () => {
  let removals = 0
  const view = await mount(panel, { host: mockHost({ requests: {
    'identity.read': () => ({ ...state, pushBinding: { host: 'github.com', login: 'work', managed: true } }),
    'github.accounts': () => [{ host: 'github.com', login: 'work', available: true }],
    'github.bind': input => {
      assert.equal(input.account, null); removals++
      return { ...state, identity: { ...state.identity, revision: 'restored' }, pushBinding: null }
    },
  } }) })
  assert.equal(view.find({ text: 'Remove binding' }), null)
  await view.select({ label: 'GitHub account' }, 'default')
  assert.equal(removals, 1)
  assert.equal(view.valueOf({ label: 'GitHub account' }), 'default')
  assert.equal(view.valueOf({ label: 'Name' }), state.identity.name)
  assert.ok(view.find({ text: 'Using default Git settings.' }))
  await view.unmount()
})

test('failed saves retain the draft and never claim success', async () => {
  const view = await mount(panel, { host: mockHost({ requests: {
    'identity.read': () => state, 'identity.save': () => { throw Error('Config is locked') },
  } }) })
  await view.type({ label: 'Name' }, 'Draft', { replace: true })
  await view.press({ text: 'Save' })
  assert.ok(view.find({ text: /Config is locked/ }))
  assert.equal(view.valueOf({ label: 'Name' }), 'Draft')
  assert.equal(view.find({ text: 'Saved.' }), null)
  await view.unmount()
})
