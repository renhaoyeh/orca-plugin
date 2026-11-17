import { atom, read, set, plugin, on, Stack, Row, Heading, Text, Input, Button, IconButton, Select, Callout, Spinner, type PanelContext } from 'orca'
import type { IdentityState } from './protocol'

const state = atom<IdentityState | null>(null)
const name = atom(''), email = atom(''), busy = atom(false), error = atom(''), notice = atom('')
const accounts = atom<{ host: string; login: string; available: boolean }[]>([])
const selected = atom('default'), githubProblem = atom(''), accountsLoading = atom(false)
let revision = 0, accountRevision = 0
async function refreshAccounts() {
  const request = ++accountRevision
  set(accountsLoading, true); set(githubProblem, '')
  try {
    const rows = await plugin.request('github.accounts')
    if (request === accountRevision) set(accounts, rows)
  } catch (cause) {
    if (request === accountRevision) { set(accounts, []); set(githubProblem, cause instanceof Error ? cause.message : String(cause)) }
  } finally { if (request === accountRevision) set(accountsLoading, false) }
}
async function chooseAccount(key: string) {
  const value = read(state), identity = value?.identity
  if (read(busy) || !identity || !value?.workspaceId || key === read(selected)) return
  if (key === 'default') { await removeBinding(); return }
  const account = read(accounts).find(row => JSON.stringify([row.host, row.login]) === key)
  if (!account?.available) return
  const previous = read(selected), request = ++revision
  let switched = false
  set(selected, key); set(busy, true); set(error, ''); set(notice, '')
  try {
    const saved = await plugin.request('github.bind', {
      workspaceId: value.workspaceId, repoPath: identity.repoPath, revision: identity.revision,
      account: { host: account.host, login: account.login },
    })
    if (request !== revision) return
    if (saved.workspaceId !== value.workspaceId) { apply(saved); return }
    switched = true
    set(state, saved)
    set(notice, 'Account switched.')
    const author = await plugin.request('github.author', { host: account.host, login: account.login })
    if (request === revision) {
      set(name, author.name); set(email, author.email)
      set(notice, author.email ? 'Account switched.' : 'No public email. Enter your commit email below.')
    }
  } catch (cause) {
    if (request === revision) {
      if (!switched) set(selected, previous)
      const message = cause instanceof Error ? cause.message : String(cause)
      set(notice, '')
      set(error, switched ? `Account switched, but the profile could not be loaded. ${message}` : message)
    }
  } finally { set(busy, false) }
}
function apply(value: IdentityState) {
  set(state, value); set(name, value.identity?.name ?? ''); set(email, value.identity?.email ?? '')
  set(selected, value.pushBinding ? JSON.stringify([value.pushBinding.host, value.pushBinding.login]) : 'default')
}
async function refresh() {
  const request = ++revision
  set(state, null); set(error, ''); set(notice, ''); set(selected, 'default')
  try {
    const value = await plugin.request('identity.read')
    if (request === revision) apply(value)
  } catch (cause) { if (request === revision) set(error, cause instanceof Error ? cause.message : String(cause)) }
}
async function removeBinding() {
  const value = read(state), identity = value?.identity
  if (read(busy) || !identity || !value?.workspaceId) return
  const request = ++revision
  set(busy, true); set(error, ''); set(notice, '')
  try {
    const saved = await plugin.request('github.bind', {
      workspaceId: value.workspaceId, repoPath: identity.repoPath, revision: identity.revision,
      account: null,
    })
    if (request === revision) {
      // Preserve unsaved author edits while adopting the new config revision.
      if (saved.workspaceId === value.workspaceId) set(state, saved)
      else apply(saved)
      set(selected, 'default')
      set(notice, 'Using default Git settings.')
    }
  } catch (cause) { if (request === revision) set(error, cause instanceof Error ? cause.message : String(cause)) }
  finally { set(busy, false) }
}
async function save() {
  const value = read(state), identity = value?.identity
  if (read(busy) || !identity || !value?.workspaceId) return
  const request = ++revision
  set(busy, true); set(error, ''); set(notice, '')
  try {
    const saved = await plugin.request('identity.save', {
      workspaceId: value.workspaceId, repoPath: identity.repoPath, revision: identity.revision,
      name: read(name), email: read(email),
    })
    if (request === revision) { apply(saved); set(notice, 'Saved.') }
  } catch (cause) { if (request === revision) set(error, cause instanceof Error ? cause.message : String(cause)) }
  finally { set(busy, false) }
}
export function setup(ctx: PanelContext) {
  let previous: string | null | undefined
  ctx.subscriptions.push(on('workspace.changed', ({ context }) => {
    const key = context?.workspaceId ?? null
    if (key === previous || key === read(state)?.workspaceId) { previous = key; return }
    previous = key; void refresh()
  }))
  void refresh(); void refreshAccounts()
  return () => { revision++; accountRevision++ }
}
export default function Panel() {
  const value = read(state), identity = value?.identity, pending = read(busy)
  const changed = identity && (read(name) !== identity.name || read(email) !== identity.email)
  const options = read(accounts).map(account => ({ value: JSON.stringify([account.host, account.login]), label: `${account.login} · ${account.host}${account.available ? '' : ' · unavailable'}`, disabled: !account.available }))
  options.unshift({ value: 'default', label: 'Default', disabled: false })
  if (value?.pushBinding && !options.some(option => option.value === JSON.stringify([value.pushBinding!.host, value.pushBinding!.login]))) options.push({ value: JSON.stringify([value.pushBinding.host, value.pushBinding.login]), label: `${value.pushBinding.login} · ${value.pushBinding.host} · unavailable`, disabled: true })
  return <Stack gap="lg">
    <Row justify="between" align="center">
      <Heading level={2}>Git Identity</Heading>
      <IconButton icon="refresh" label="Refresh identity" variant="ghost" disabled={pending || read(accountsLoading)} onPress={async () => { await Promise.all([refresh(), refreshAccounts()]) }} />
    </Row>
    {read(error) && <Callout tone="danger" title="Could not complete">{read(error)}</Callout>}
    {!value && !read(error) && <Spinner label="Reading Git identity" />}
    {value?.problem && <Callout tone="warning">{value.problem}</Callout>}
    {identity && <Stack gap="md">
      <Stack gap="sm">
        <Select label="GitHub account" placeholder={read(accountsLoading) ? 'Reading gh accounts…' : 'Choose a gh account'} value={read(selected)} disabled={pending || read(accountsLoading) || value?.pushBinding?.managed === false} options={options} onChange={chooseAccount} />
        {read(githubProblem) && <Text muted size="sm">{read(githubProblem)} You can still enter an author manually.</Text>}
        {!read(accountsLoading) && !read(githubProblem) && read(accounts).length === 0 && <Text muted size="sm">No gh accounts found. Run gh auth login, then refresh.</Text>}
        {value?.pushBinding?.managed === false && <Callout tone="warning">Push settings were changed externally. Refresh or inspect Git config; the plugin will not overwrite them.</Callout>}
      </Stack>
      <Stack gap="sm">
        <Input label="Name" value={read(name)} maxLength={200} disabled={pending || !identity.canSave} onChange={next => set(name, next)} />
      </Stack>
      <Stack gap="sm">
        <Input label="Email" value={read(email)} maxLength={254} disabled={pending || !identity.canSave} onChange={next => set(email, next)} />
      </Stack>
      {!identity.canSave && <Callout tone="warning">A worktree or command-level setting overrides the repository. Resolve that override before saving.</Callout>}
      {identity.environmentOverride && <Callout tone="warning">Identity environment variables are set in the worker. They can override Git config; other terminals may have different overrides.</Callout>}
      <Row gap="sm" align="center">
        <Button variant="outline" icon="check" disabled={pending || !identity.canSave || !changed || !read(name).trim() || !read(email).trim()} onPress={save}>{pending ? 'Saving…' : 'Save'}</Button>
        {read(notice) && <Text muted size="sm">{read(notice)}</Text>}
      </Row>
    </Stack>}
  </Stack>
}
