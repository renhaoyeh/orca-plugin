import type { OrcaWorkerApi } from 'orca/worker'
import type { IdentityState } from './protocol'
import { readIdentity, saveIdentity } from './git.mjs'
import { openPanel } from './open-panel.mjs'
import { listGitHubAccounts, readGitHubAuthor } from './github.mjs'
import { readPushBinding, savePushBinding } from './push.mjs'

export function createWorker(deps = { readIdentity, saveIdentity, openPanel }, github = { listGitHubAccounts, readGitHubAuthor }, push = { readPushBinding, savePushBinding }) {
  return async function activate(orca: OrcaWorkerApi) {
    let saving = false
    let workspaceKey: string | null | undefined
    async function target() {
      const context = await orca.host.call('workspace.readContext', {})
      if (!context?.workspaceId) throw Error('Open a local Git workspace first.')
      const list = await orca.host.call('workspace.list', {})
      const row = list.workspaces.find(item => item.id === context.workspaceId)
      if (!row || (row.hostId && row.hostId !== 'local') || !/^[a-z]:[\\/]/i.test(row.path)) throw Error('Only local Windows Git workspaces are supported.')
      return row
    }
    async function refresh(): Promise<IdentityState> {
      let value: IdentityState = { workspaceId: null, workspaceName: '', identity: null, problem: '' }
      try {
        const row = await target()
        value.workspaceId = row.id; value.workspaceName = row.name
        value.identity = await deps.readIdentity(row.path)
        value.pushBinding = await push.readPushBinding(row.path)
      } catch (cause) { value.problem = cause instanceof Error ? cause.message : String(cause) }
      return value
    }
    orca.commands.register('identity.open', () => deps.openPanel())
    orca.panels.handle('identity.read', () => refresh())
    orca.panels.handle('github.accounts', async () => {
      await target()
      return github.listGitHubAccounts()
    })
    orca.panels.handle('github.author', async input => {
      await target()
      const accounts = await github.listGitHubAccounts()
      const account = accounts.find(account => account.host === input.host && account.login === input.login && account.available)
      if (!account) throw Error('GitHub account is not available. Refresh the account list.')
      return github.readGitHubAuthor(account)
    })
    async function withSaveTarget(input: { workspaceId: string }, write: (cwd: string, guard: () => Promise<void>) => Promise<unknown>) {
      if (saving) throw Error('A save is already in progress. Please wait.')
      saving = true
      try {
        const row = await target()
        if (row.id !== input.workspaceId) throw Error('Workspace changed. Refresh before saving.')
        await write(row.path, async () => {
          const current = await target()
          if (current.id !== row.id || current.path !== row.path) throw Error('Workspace changed. Refresh before saving.')
        })
        return await refresh()
      } finally { saving = false }
    }
    orca.panels.handle('identity.save', input => withSaveTarget(input, (cwd, beforeCommit) => deps.saveIdentity(cwd, input, { beforeCommit })))
    orca.panels.handle('github.bind', input => withSaveTarget(input, async (cwd, beforeCommit) => {
      if (input.account) {
        const accounts = await github.listGitHubAccounts()
        if (!accounts.some(account => account.available && account.host === input.account!.host && account.login === input.account!.login)) throw Error('GitHub account is unavailable. Refresh before binding.')
      }
      return push.savePushBinding(cwd, input, { beforeCommit })
    }))
    orca.events.on('workspace.changed', async ({ context }) => {
      const key = context?.workspaceId ?? null
      if (workspaceKey === key) return
      workspaceKey = key
      await refresh()
    })
    await refresh()
  }
}
export default createWorker()
