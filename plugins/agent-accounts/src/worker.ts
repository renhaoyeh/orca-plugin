import type { OrcaWorkerApi } from 'orca/worker'
import { listAllAccounts as listAccounts, createTerminal, createLoginTerminal } from './accounts.mjs'
import type { AccountState } from './protocol'
import { launchPi } from './pi.mjs'
import { text, localeOf } from './i18n.mjs'
import { createApiTerminal, newApiProfile, parseApiProfiles } from './api-profiles.mjs'

type LaunchAccount = { id: string; label: string; home: string; disabledReason: string; kind?: string; provider?: string }

export function createWorker(deps = { listAccounts, createTerminal }, apiDeps = { createApiTerminal, newApiProfile }, loginDeps = { createLoginTerminal }, piDeps = { launchPi }) {
  return async function activate(orca: OrcaWorkerApi): Promise<void> {
    let launching = false
    let statusAccounts: LaunchAccount[] = []
    let apiProfiles: { id: string; name: string }[] = []
    let piEnabled = false
    let workspaceKey: string | null | undefined
    let statusRevision = 0
    let names: Record<string, string> = {}
    let sourceLocale = 'en'
    const t = (source: string, values = {}) => text(source, sourceLocale, values)
    // Register commands synchronously: Orca snapshots handlers before async initialization finishes.
    const ready = Promise.all([orca.storage.get('display-names'), orca.storage.get('orca-locale'), orca.storage.get('api-profiles'), orca.storage.get('pi-enabled')]).then(([saved, savedLocale, savedApi, savedPi]) => {
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        names = Object.fromEntries(Object.entries(saved).filter(([, name]) => typeof name === 'string' && name.length <= 40)) as Record<string, string>
      }
      if (typeof savedLocale === 'string') sourceLocale = localeOf(savedLocale)
      apiProfiles = parseApiProfiles(savedApi)
      piEnabled = savedPi === true
    })

    async function withLaunchLock<T>(action: () => Promise<T>): Promise<T | { pending: true }> {
      // Reserve synchronously, before workspace/account lookups. Ignore repeated clicks;
      // do not throw (Orca would show an error toast) or queue another launch.
      if (launching) return { pending: true }
      launching = true
      try { return await action() }
      finally { launching = false }
    }

    async function allAccounts(): Promise<LaunchAccount[]> {
      await ready
      return [
        ...await deps.listAccounts(),
        ...apiProfiles.map(profile => ({ id: profile.id, label: `${profile.name} · API`, home: '', disabledReason: '', kind: 'api' })),
        ...(piEnabled ? [{ id: 'pi-default', label: 'Pi', home: '', disabledReason: '', provider: 'pi' }] : []),
      ]
    }

    async function updateStatus(accounts: typeof statusAccounts) {
      // Pi shares the existing eight slots; reserve its place when the account list is full.
      const pi = accounts.find(account => account.provider === 'pi')
      statusAccounts = pi ? [...accounts.filter(account => account.id !== pi.id).slice(0, 7), pi] : accounts.slice(0, 8)
      await Promise.all(Array.from({ length: 8 }, (_, index) => {
        const account = statusAccounts[index]
        return orca.host.call('statusBar.update', {
          id: `account-${index + 1}`, visible: !!account,
          text: account ? names[account.id] || account.label : '',
          icon: account?.provider === 'pi' ? 'bot' : 'terminal',
          tooltip: account ? t(account.disabledReason || (account.provider === 'pi' ? '用 {name} 開啟 Pi 對話' : account.provider === 'claude' ? '用 {name} 開啟 Claude 終端' : '用 {name} 開啟 Codex 終端'), { name: names[account.id] || account.label }) : '',
          tone: account?.disabledReason ? 'warning' : 'neutral',
        })
      }))
    }

    async function syncStatus() {
      await ready
      const revision = ++statusRevision
      const context = await orca.host.call('workspace.readContext', {})
      workspaceKey = context?.workspaceId ?? null
      const accounts = context?.workspaceId ? await allAccounts() : []
      if (revision === statusRevision) await updateStatus(accounts)
    }
    async function state(): Promise<AccountState> {
      await ready
      const context = await orca.host.call('workspace.readContext', {})
      const workspaceId = context?.workspaceId ?? null
      const result = await orca.host.call('workspace.list', {})
      const workspace = result.workspaces.find(item => item.id === workspaceId)
      const local = workspace && (!workspace.hostId || workspace.hostId === 'local')
      const accounts = await allAccounts()
      await updateStatus(accounts)
      return {
        accounts: accounts.map(({ id, label, disabledReason, kind, provider }) => ({ id, label: names[id] || label, identityLabel: label, disabledReason: t(disabledReason), ...(kind ? { kind } : {}), ...(provider ? { provider } : {}) })),
        workspaceId: local ? workspaceId : null,
        workspaceName: workspace?.name ?? '',
        workspaceError: !workspace ? t('請先開啟一個工作區。') : !local ? t('第一版只支援本機 Windows 工作區。') : '',
        language: sourceLocale,
      }
    }
    orca.panels.handle('accounts.list', state)
    orca.panels.handle('accounts.locale', async ({ locale }) => {
      await ready
      const next = localeOf(locale)
      if (next !== sourceLocale) {
        await orca.storage.set('orca-locale', next)
        sourceLocale = next
      }
      return await state()
    })
    orca.panels.handle('accounts.add', async ({ provider, workspaceId }) => {
      if (provider !== 'codex' && provider !== 'claude') throw Error('Unsupported account provider.')
      return withLaunchLock(async () => {
        const current = await state()
        if (!current.workspaceId || current.workspaceId !== workspaceId) throw Error(t('工作區已切換，請重新整理後再開啟。'))
        return await loginDeps.createLoginTerminal(workspaceId, provider)
      })
    })
    orca.panels.handle('accounts.pi.add', async () => {
      await ready
      await orca.storage.set('pi-enabled', true)
      piEnabled = true
      return await state()
    })
    orca.panels.handle('accounts.pi.remove', async () => {
      await ready
      await orca.storage.set('pi-enabled', false)
      piEnabled = false
      return await state()
    })
    orca.panels.handle('accounts.rename', async ({ accountId, name }) => {
      await ready
      if (typeof name !== 'string' || name.trim().length > 40 || /[\r\n\0]/.test(name)) throw Error(t('名稱最多 40 個字，不能包含換行。'))
      if (!(await allAccounts()).some(account => account.id === accountId)) throw Error(t('帳號已不存在，請重新整理。'))
      const next = { ...names }
      if (name.trim()) next[accountId] = name.trim()
      else delete next[accountId]
      await orca.storage.set('display-names', next)
      names = next
      return await state()
    })
    orca.panels.handle('accounts.api.add', async ({ name, key }) => {
      await ready
      const profile = apiDeps.newApiProfile(name, key)
      const protection = await orca.host.call('secrets.protection', {})
      if (protection.status !== 'os-keyring') throw Error(t('Encrypted credential storage is unavailable. API key was not saved.'))
      await orca.secrets.set(profile.id, key.trim())
      const next = [...apiProfiles, profile]
      try { await orca.storage.set('api-profiles', next) }
      catch { await orca.secrets.delete(profile.id); throw Error(t('Could not save the API profile. No API key was retained.')) }
      apiProfiles = next
      return await state()
    })
    orca.panels.handle('accounts.api.remove', async ({ accountId }) => {
      await ready
      if (!apiProfiles.some(profile => profile.id === accountId)) throw Error(t('帳號已不存在，請重新整理。'))
      await orca.secrets.delete(accountId)
      const next = apiProfiles.filter(profile => profile.id !== accountId)
      await orca.storage.set('api-profiles', next)
      apiProfiles = next
      return await state()
    })
    // Call only inside withLaunchLock, shared by panel requests and status commands.
    async function launch(accountId: string, workspaceId: string) {
      const current = await state()
      if (!current.workspaceId || current.workspaceId !== workspaceId) throw Error(t('工作區已切換，請重新整理後再開啟。'))
      const account = (await allAccounts()).find(item => item.id === accountId)
      if (!account || account.disabledReason) throw Error(t(account?.disabledReason || '帳號已不存在，請重新整理。'))
      try {
        if (account.provider === 'pi') return await piDeps.launchPi(workspaceId)
        if (account.kind === 'api') {
          const profile = apiProfiles.find(profile => profile.id === account.id)!
          const key = await orca.secrets.get(profile.id)
          if (!key) throw Error(t('API key is missing. Remove this profile and add it again.'))
          return await apiDeps.createApiTerminal(workspaceId, { ...profile, name: names[profile.id] || profile.name }, key)
        }
        return await deps.createTerminal(workspaceId, { ...account, label: names[account.id] || account.label })
      }
      catch (cause) {
        orca.log(cause instanceof Error ? cause.message : 'Agent terminal creation failed')
        throw cause
      }
    }
    orca.panels.handle('accounts.launch', ({ accountId, workspaceId }) => withLaunchLock(() => launch(accountId, workspaceId)))
    for (let index = 0; index < 8; index++) {
      orca.commands.register(`accounts.open${index + 1}`, () => withLaunchLock(async () => {
        try {
          await ready
          if (statusAccounts.length === 0) await syncStatus()
          // Capture the displayed account ID before refreshing; never launch a different reordered account.
          const account = statusAccounts[index]
          if (!account) throw Error(t('這個帳號已不存在，請重新整理帳號列表。'))
          const context = await orca.host.call('workspace.readContext', {})
          if (!context?.workspaceId) throw Error(t('請先開啟一個工作區。'))
          return await launch(account.id, context.workspaceId)
        } catch (cause) {
          orca.log(`accounts.open${index + 1}: ${cause instanceof Error ? cause.message : String(cause)}`)
          throw cause
        }
      }))
    }
    orca.events.on('workspace.changed', async ({ context }) => {
      if ((context?.workspaceId ?? null) === workspaceKey) return
      try { await syncStatus() }
      catch (cause) { orca.log(cause instanceof Error ? cause.message : 'Account refresh failed') }
    })
    try { await syncStatus() }
    catch (cause) { orca.log(cause instanceof Error ? cause.message : 'Account refresh failed') }
  }
}

export default createWorker()
