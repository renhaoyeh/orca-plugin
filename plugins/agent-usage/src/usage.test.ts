import { assert, mockHost, mount, test, type TreeSnapshot } from 'orca/testing'
import { readRoster } from './usage'
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
  assert.equal(view.find({ text: '25%' })?.props.tone, 'warning')
  assert.equal(view.find({ text: '80%' })?.props.tone, 'neutral')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('switches all percentages and meters together and remembers the mode', async () => {
  const host = mockHost({ requests: { 'usage.read': () => readRoster(snapshot) } })
  const view = await mount(panel, { locale: 'zh-Hant-TW', host })
  assert.equal(view.find({ type: 'Button', text: '剩餘額度 ⇅' })?.props.tooltip, '切換成已使用')
  assert.equal(view.find({ type: 'Progress', label: '每週 · 剩餘額度 25%' })?.props.value, 25)
  await view.press({ text: '剩餘額度 ⇅' })
  assert.equal(view.find({ type: 'Button', text: '已使用 ⇅' })?.props.tooltip, '切換成剩餘額度')
  assert.equal(view.find({ type: 'Progress', label: '每週 · 已使用 75%' })?.props.value, 75)
  assert.equal(view.find({ type: 'Progress', label: '每週 · 已使用 20%' })?.props.value, 20)
  assert.equal(view.find({ text: '75%' })?.props.tone, 'warning')
  const saved = view.persisted.plugin
  await view.unmount()

  const reopened = await mount(panel, { locale: 'zh-Hant-TW', persisted: { plugin: saved }, host })
  assert.equal(reopened.find({ type: 'Progress', label: '每週 · 已使用 75%' })?.props.value, 75)
  await reopened.press({ text: '已使用 ⇅' })
  assert.equal(reopened.find({ type: 'Progress', label: '每週 · 剩餘額度 25%' })?.props.value, 25)
  await reopened.unmount()
})
