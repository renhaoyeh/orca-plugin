import type { Provider, UsageRow, UsageWindow } from './protocol'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const array = (value: unknown) => Array.isArray(value) ? value.map(record) : []
const string = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 240) : ''
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const timestamp = (value: unknown) => Math.max(0, Math.min(number(value), 8.64e15))
const selectedId = (value: unknown) => value === null ? 'system' : string(value)
const kinds = ['session', 'weekly', 'fableWeekly', 'monthly'] as const

function windowOf(kind: UsageWindow['kind'], value: RecordValue, label = ''): UsageWindow[] {
  if (typeof value.usedPercent !== 'number' || !Number.isFinite(value.usedPercent)) return []
  return [{
    kind, label, minutes: number(value.windowMinutes), resetsAt: timestamp(value.resetsAt),
    used: Math.round(Math.min(100, Math.max(0, value.usedPercent)) * 10) / 10,
  }]
}

function usage(limits: RecordValue, loading: boolean, needsSignIn: boolean, observedAt?: unknown) {
  const buckets = array(limits.buckets).flatMap(bucket => windowOf('bucket', bucket, string(bucket.name) || string(bucket.group) || string(bucket.windowName)))
  const windows = buckets.length ? buckets : kinds.flatMap(kind => windowOf(kind, record(limits[kind])))
  const status: UsageRow['status'] =
    needsSignIn ? 'sign-in' : loading || limits.status === 'fetching' ? 'loading' :
    limits.status === 'error' ? 'error' : windows.length ? 'available' : 'unavailable'
  return { windows, status, checkedAt: timestamp(limits.updatedAt) || timestamp(observedAt), plan: string(limits.planType) }
}

function identity(account: RecordValue) {
  const displayName = string(account.displayName) || string(account.label)
  const email = string(account.email)
  const workspace = string(account.workspaceLabel)
  const distro = string(account.wslDistro)
  return {
    label: displayName || email,
    detail: [...new Set([displayName ? email : '', workspace, distro && `WSL · ${distro}`].filter(Boolean))].join(' · '),
  }
}

function managedRows(source: RecordValue, limits: RecordValue, provider: 'codex' | 'claude'): UsageRow[] {
  const block = record(source[provider])
  const byRuntime = record(block.activeAccountIdsByRuntime)
  const active = record(limits[provider])
  const reading = record(record(active.usageMetadata).readingAccount)
  const target = record(limits[`${provider}Target`])
  const distro = string(reading.wslDistro) || string(target.wslDistro)
  const readingId = selectedId(reading.accountId)
  const current = target.runtime === 'wsl' && distro ? record(byRuntime.wsl)[distro] : byRuntime.host
  const activeId = selectedId(current) || selectedId(block.activeAccountId) || readingId
  const inactive = new Map(array(limits[provider === 'codex' ? 'inactiveCodexAccounts' : 'inactiveClaudeAccounts']).map(entry => [string(entry.accountId), entry]))
  const system = record(block.systemDefault)
  const systemIds = new Set([activeId, readingId, ...inactive.keys()].filter(id => id === 'system' || id.startsWith('system:')))
  if (!systemIds.size && system.hasAuth === true) systemIds.add('system')
  const accounts: RecordValue[] = [
    ...array(block.accounts),
    ...[...systemIds].map(id => ({ ...system, id, ...(id.startsWith('system:') ? { wslDistro: id.slice(7) } : {}) })),
  ]
  const ids = new Set<string>()
  return accounts.flatMap(account => {
    const id = string(account.id)
    if (!id || ids.has(id)) return []
    ids.add(id)
    const saved = inactive.get(id)
    // Attribute current usage to the credentials Orca read, which may differ from the selected account.
    const useCurrent = readingId ? id === readingId : id === activeId && active.status === 'ok'
    const cached = record(saved?.rateLimits)
    const currentError = !readingId && id === activeId && ['error', 'fetching', 'unavailable'].includes(string(active.status))
    const meter = useCurrent ? active : currentError ? { ...cached, status: active.status } : cached
    return [{
      key: `${provider}:${id}`, provider, ...identity(account),
      system: systemIds.has(id), active: id === activeId,
      ...usage(meter, !useCurrent && saved?.isFetching === true, account.needsSignIn === true, saved?.updatedAt),
    }]
  })
}

function antigravityRows(source: RecordValue, limits: RecordValue): UsageRow[] {
  const block = record(source.antigravity)
  const active = record(limits.antigravity)
  const reading = record(record(active.usageMetadata).account)
  const current = record(block.currentAccount)
  const readings = new Map(array(limits.antigravityAccounts).map(entry => [string(entry.accountId), entry]))
  const ids = new Set<string>()
  const rows = [...array(block.accounts), ...readings.values()].flatMap(account => {
    const id = string(account.id) || string(account.accountId)
    if (!id || ids.has(id)) return []
    ids.add(id)
    const saved = readings.get(id)
    const selected = saved?.active === true || (!saved && id === string(block.activeAccountId))
    const meter = record(saved?.rateLimits)
    const latest = Object.keys(meter).length ? meter : string(reading.id) === id ? active : {}
    return [{
      key: `antigravity:${id}`, provider: 'antigravity' as const, ...identity({ ...saved, ...account }),
      system: false, active: selected, ...usage(latest, false, account.needsSignIn === true),
    }]
  })
  if (rows.length) return rows
  if (usage(active, false, false).windows.length || string(current.email)) {
    return [{ key: 'antigravity', provider: 'antigravity', ...identity({ ...current, ...reading }), system: false, active: true, ...usage(active, false, false) }]
  }
  return []
}

const configuredProviders = {
  gemini: [], opencodeGo: ['opencodeGoCookieConfigured', 'opencodeGoApiKeyConfigured'], kimi: [],
  minimax: ['minimaxCookieConfigured', 'minimaxApiKeyConfigured'], grok: ['grokAuthConfigured'],
  cursor: ['cursorAuthConfigured'], zcode: ['zcodePlanApiKeyConfigured'], muse: [],
} as const

export function readRoster(value: unknown): UsageRow[] {
  const source = record(value)
  if (!source.rateLimits || typeof source.rateLimits !== 'object' || Array.isArray(source.rateLimits)) {
    throw Error('Orca did not return usage data.')
  }
  const limits = record(source.rateLimits)
  const rows = [...managedRows(source, limits, 'claude'), ...managedRows(source, limits, 'codex'), ...antigravityRows(source, limits)]
  for (const provider of Object.keys(configuredProviders) as (keyof typeof configuredProviders)[]) {
    const meter = record(limits[provider])
    const state = usage(meter, false, false)
    if (!state.windows.length && !configuredProviders[provider].some(flag => limits[flag] === true)) continue
    rows.push({ key: provider, provider, label: '', detail: '', system: false, active: false, ...state })
  }
  for (const provider of ['opencode', 'devin'] as const) {
    const block = record(source[provider])
    for (const account of array(block.accounts)) {
      const id = string(account.id)
      if (!id) continue
      rows.push({ key: `${provider}:${id}`, provider, ...identity(account), system: false,
        active: id === string(block.activeAccountId), ...usage({}, false, account.needsSignIn === true) })
    }
  }
  return rows
}
