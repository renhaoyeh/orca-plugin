import type { OrcaWorkerApi } from 'orca/worker'
import type { Project } from './protocol'
import { asanaClient } from './asana-client.mjs'
import { connection } from './api.mjs'
async function workspaceScope(orca: OrcaWorkerApi) {
  const context = await orca.host.call('workspace.readContext', {})
  if (!context?.workspaceId) return 'source:asana'
  const { workspaces, truncated } = await orca.host.call('workspace.list', {})
  if (truncated) throw Error('Workspace list is incomplete. Cannot safely bind an Asana project.')
  const row = workspaces.find(row => row.id === context.workspaceId)
  if (!row) throw Error('Workspace changed. Reopen Asana.')
  const list = await orca.host.call('project.list', {})
  if (list.truncated) throw Error('Project list is incomplete. Cannot safely bind an Asana project.')
  const project = list.projects.find(project => project.id === row.projectId)
  if (row.projectId && !project) throw Error('Workspace project is unavailable. Reopen Asana.')
  return JSON.stringify([project?.hostId || row.hostId || 'local', (project?.path || row.path).replace(/\\/g, '/').replace(/\/+$/, '')])
}
export function createWorker(makeClient = asanaClient, readScope = workspaceScope) {
  return async function activate(orca: OrcaWorkerApi) {
    let saving = false
    async function saved() {
      const { value } = await orca.host.call('secrets.get', { key: 'connection.v1' })
      if (!value) return null
      try { return connection('asana', JSON.parse(value)) } catch { throw Error('Saved connection is invalid. Replace the token in Settings.') }
    }
    async function api() {
      const config = await saved()
      if (!config) throw Error('Connect an API token first.')
      return makeClient('asana', config)
    }
    async function state() {
      const config = await saved(), scope = await readScope(orca)
      const { value } = await orca.host.call('storage.get', { key: 'bindings.v1' })
      const bindings = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Project> : {}
      const tab = (await orca.host.call('storage.get', { key: 'tab' })).value === 'all' ? 'all' : 'mine'
      return { configured: !!config, url: config?.url ?? '', scope, binding: bindings[scope] || null, tab }
    }
    orca.panels.handle('connection.read', state)
    orca.panels.handle('connection.save', async input => {
      if (saving) throw Error('Settings are being saved. Please wait.')
      saving = true
      try {
        const previous = await saved()
        const config = connection('asana', { token: input.token || previous?.token })
        // Original AsanaSource saves a nonempty token; API reads report authentication errors.
        await orca.host.call('secrets.set', { key: 'connection.v1', value: JSON.stringify(config) })
        return await state()
      } finally { saving = false }
    })
    orca.panels.handle('connection.remove', async () => {
      if (saving) throw Error('Settings are being saved. Please wait.')
      saving = true
      try { await orca.host.call('secrets.delete', { key: 'connection.v1' }); return await state() }
      finally { saving = false }
    })
    orca.panels.handle('project.bind', async input => {
      if (saving) throw Error('Settings are being saved. Please wait.')
      saving = true
      try {
        if (await readScope(orca) !== input.scope) throw Error('Workspace changed. Choose the project again.')
        const project = await (await api()).projectInfo(input.id)
        if (await readScope(orca) !== input.scope) throw Error('Workspace changed. Choose the project again.')
        const { value } = await orca.host.call('storage.get', { key: 'bindings.v1' })
        const bindings = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Project> : {}
        await orca.host.call('storage.set', { key: 'bindings.v1', value: { ...bindings, [input.scope]: project } })
        return project
      } finally { saving = false }
    })
    orca.panels.handle('view.save', async input => {
      if (!['mine', 'all'].includes(input.tab)) throw Error('Invalid Asana view.')
      await orca.host.call('storage.set', { key: 'tab', value: input.tab })
      return { ok: true }
    })
    orca.panels.handle('projects.list', async input => (await api()).projects(null, input?.query ?? ''))
    orca.panels.handle('issues.subtasks', async input => (await api()).subtasks(input.id))
    orca.panels.handle('issues.detail', async input => (await api()).detail(input.id, input.project))
    orca.panels.handle('issues.list', async input => (await api()).issues(input.project, input.cursor ?? null, input.tab ?? 'mine'))
  }
}
export default createWorker()
