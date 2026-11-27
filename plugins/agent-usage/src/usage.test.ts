import { assert, mockHost, mount, test, type TreeSnapshot } from 'orca/testing'
import { displayPercent, readRoster } from './usage'
import * as panel from './panel'

const weekly = (usedPercent: number) => ({ usedPercent, windowMinutes: 10080, resetsAt: 1795608000000 })
function countCards(node: TreeSnapshot | string | null): number {
  if (!node || typeof node === 'string') return 0
  const self = node.type === 'Box' && node.props?.background === 'card' ? 1 : 0
  return self + (node.children || []).reduce((count, child) => count + countCards(child), 0)
}
const snapshot = {
  codex: {
    activeAccountId: 'work',
    accounts: [
      { id: 'work', displayName: 'Work', email: 'work@example.test', workspaceLabel: 'Team' },
      { id: 'personal', displayName: 'Personal' },
      { id: 'new', displayName: 'Recent login' },
    ],
  },
  rateLimits: {
    codex: { status: 'ok', planType: 'team', weekly: weekly(75), usageMetadata: { readingAccount: { accountId: 'work' } } },
    inactiveCodexAccounts: [{ accountId: 'personal', rateLimits: { weekly: weekly(20), planType: 'prolite' } }],
  },
}

test('keeps active, inactive, and unmeasured accounts in a single roster', () => {
  const roster = readRoster(snapshot)
  assert.deepEqual(roster.map(account => [account.key, account.active, account.windows[0]?.used]), [
    ['codex:work', true, 75], ['codex:personal', false, 20], ['codex:new', false, undefined],
  ])
  assert.equal(roster[2].status, 'unavailable')
})

test('never assigns a verified reading to a different selected account', () => {
  const roster = readRoster({
    ...snapshot,
    codex: { ...snapshot.codex, activeAccountId: 'new', systemDefault: { hasAuth: true } },
  })
  assert.equal(roster.find(row => row.key === 'codex:new')?.status, 'unavailable')
  assert.equal(roster.find(row => row.key === 'codex:work')?.windows[0]?.used, 75)
  assert.equal(roster.find(row => row.key === 'codex:system')?.system, true)
})

test('includes model pools and configured meters, and keeps unrelated provider data private', () => {
  const roster = readRoster({
    antigravity: { accounts: [{ id: 'project', email: 'project@example.test' }] },
    rateLimits: {
      cursorAuthConfigured: true,
      antigravityAccounts: [{ accountId: 'project', active: true, rateLimits: {
        buckets: [{ ...weekly(55), name: 'Gemini' }], error: 'private vendor response',
      } }],
      gemini: { status: 'unavailable' },
    },
  })
  assert.deepEqual(roster.map(row => row.provider), ['antigravity', 'cursor'])
  assert.equal(roster[0].windows[0].label, 'Gemini')
  assert.equal(roster[1].status, 'unavailable')
  assert.ok(!JSON.stringify(roster).includes('private vendor response'))
})

test('keeps clamped raw readings in the roster and rounds once for used and left displays', () => {
  const roster = readRoster({
    codex: { activeAccountId: 'work', accounts: [{ id: 'work' }] },
    rateLimits: { codex: { status: 'ok', weekly: weekly(79.49), usageMetadata: { readingAccount: { accountId: 'work' } } } },
  })
  const raw = roster[0].windows[0].used
  assert.equal(raw, 79.49)
  assert.equal(displayPercent(raw, 'used'), 79)
  assert.equal(displayPercent(raw, 'remaining'), 21)
  assert.equal(displayPercent(79.5, 'used'), 80)
  assert.equal(displayPercent(79.5, 'remaining'), 20)
  assert.equal(displayPercent(-1, 'used'), 0)
  assert.equal(displayPercent(101, 'remaining'), 0)
})

test('shows one card per account with usage and a single plan label', async () => {
  const view = await mount(panel, {
    locale: 'zh-Hant-TW', persisted: { plugin: { 'hidden-accounts.v1': ['codex:personal'] } },
    host: mockHost({ requests: { 'usage.read': () => readRoster(snapshot) } }),
  })
  assert.ok(view.find({ text: 'Work' }))
  assert.ok(view.find({ text: 'Personal' }))
  assert.equal(view.find({ text: 'Recent login' }), null)
  assert.equal(view.find({ text: 'Orca 尚未回報用量。' }), null)
  assert.deepEqual(view.findAll({ type: 'Image' }).map(icon => icon.props.src), ['assets/codex.png'])
  assert.equal(countCards(view.tree()), 2)
  assert.equal(view.findAll({ type: 'Text', text: 'Team' }).length, 1)
  assert.ok(view.find({ type: 'Text', text: 'Pro Lite' }))
  assert.equal(view.find({ type: 'Text', text: /Team\s*·\s*team/i }), null)
  assert.deepEqual(view.findAll({ type: 'IconButton' }).map(button => button.props.icon), ['refresh'])
  assert.equal(view.find({ text: '75%' })?.props.tone, 'neutral')
  assert.equal(view.find({ text: '20%' })?.props.tone, 'neutral')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('defaults to used, switches to left, and persists the selected mode', async () => {
  const host = mockHost({ requests: { 'usage.read': () => readRoster(snapshot) } })
  const view = await mount(panel, { locale: 'en-US', host })
  assert.equal(view.find({ type: 'Button', text: 'Used ⇅' })?.props.tooltip, 'Show remaining usage')
  assert.equal(view.find({ type: 'Progress', label: 'Weekly · 75% used' })?.props.value, 75)
  await view.press({ text: 'Used ⇅' })
  assert.equal(view.find({ type: 'Button', text: 'Left ⇅' })?.props.tooltip, 'Show used usage')
  assert.equal(view.find({ type: 'Progress', label: 'Weekly · 25% left' })?.props.value, 25)
  assert.equal(view.find({ type: 'Progress', label: 'Weekly · 80% left' })?.props.value, 80)
  assert.equal(view.find({ text: '25%' })?.props.tone, 'neutral')
  const saved = view.persisted.plugin
  assert.equal(saved['quota-display.v1'], 'remaining')
  await view.unmount()

  const reopened = await mount(panel, { locale: 'en-US', persisted: { plugin: saved }, host })
  assert.equal(reopened.find({ type: 'Button', text: 'Left ⇅' })?.props.tooltip, 'Show used usage')
  assert.equal(reopened.find({ type: 'Progress', label: 'Weekly · 25% left' })?.props.value, 25)
  await reopened.unmount()
})

test('uses native localized toggle, tooltip, and accessible labels', async () => {
  const host = mockHost({ requests: { 'usage.read': () => readRoster(snapshot) } })
  const hant = await mount(panel, { locale: 'zh-Hant-TW', persisted: { plugin: { 'quota-display.v1': 'remaining' } }, host })
  assert.equal(hant.find({ type: 'Button', text: '剩餘 ⇅' })?.props.tooltip, '顯示已用用量')
  assert.equal(hant.find({ type: 'Progress', label: '每週 · 剩餘 25%' })?.props.value, 25)
  await hant.unmount()

  const hans = await mount(panel, { locale: 'zh-CN', persisted: { plugin: { 'quota-display.v1': 'used' } }, host })
  assert.equal(hans.find({ type: 'Button', text: '已用 ⇅' })?.props.tooltip, '显示剩余用量')
  assert.equal(hans.find({ type: 'Progress', label: /已用 75%/ })?.props.value, 75)
  await hans.unmount()
})

test('rounds used health at the native 80 and 90 percent thresholds in either mode', async () => {
  const makeRows = (usedPercent: number) => readRoster({
    codex: { activeAccountId: 'work', accounts: [{ id: 'work', displayName: 'Work' }] },
    rateLimits: { codex: { status: 'ok', weekly: weekly(usedPercent), usageMetadata: { readingAccount: { accountId: 'work' } } } },
  })
  for (const [usedPercent, expectedTone] of [[79.49, 'neutral'], [79.5, 'warning'], [89.49, 'warning'], [89.5, 'danger']] as const) {
    const view = await mount(panel, { locale: 'en-US', host: mockHost({ requests: { 'usage.read': () => makeRows(usedPercent) } }) })
    const roundedUsed = displayPercent(usedPercent, 'used')
    assert.equal(view.find({ text: `${roundedUsed}%` })?.props.tone, expectedTone)
    await view.press({ text: 'Used ⇅' })
    assert.equal(view.find({ text: `${100 - roundedUsed}%` })?.props.tone, expectedTone)
    await view.unmount()
  }
})
