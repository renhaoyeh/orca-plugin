import type { OrcaWorkerApi } from 'orca/worker'
import type { Project } from './protocol'
import { mantisClient } from './mantis-client.mjs'
import { connection, normalizeServer } from './api.mjs'
async function workspaceScope(orca: OrcaWorkerApi) {
  const context = await orca.host.call('workspace.readContext', {})
  if (!context?.workspaceId) return 'source:mantisbt'
  const list = await orca.host.call('workspace.list', {})
  if (list.truncated) throw Error('Workspace list is incomplete. Cannot safely bind a MantisBT project.')
  const row = list.workspaces.find(row => row.id === context.workspaceId)
  if (!row) throw Error('Workspace changed. Reopen MantisBT.')
  const projects = await orca.host.call('project.list', {})
  if (projects.truncated) throw Error('Project list is incomplete. Cannot safely bind a MantisBT project.')
  const project = projects.projects.find(project => project.id === row.projectId)
  if (row.projectId && !project) throw Error('Workspace project is unavailable. Reopen MantisBT.')
  return JSON.stringify([project?.hostId || row.hostId || 'local', (project?.path || row.path).replace(/\\/g, '/').replace(/\/+$/, '')])
}
export function createWorker(makeClient = mantisClient, readScope = workspaceScope) {
  return async function activate(orca: OrcaWorkerApi) {
    let saving = false
    async function saved() {
      const { value } = await orca.host.call('secrets.get', { key: 'connection.v1' })
      if (!value) return null
      try { return connection('mantisbt', JSON.parse(value)) } catch { throw Error('Saved connection is invalid. Replace it in Settings.') }
    }
    async function scope() { return JSON.stringify([await readScope(orca), (await saved())?.url || '']) }
    async function api() {
      const config = await saved()
      if (!config) throw Error('Connect an API token first.')
      return makeClient('mantisbt', config)
    }
    async function state() {
      const config = await saved(), key = JSON.stringify([await readScope(orca), config?.url || ''])
      const { value } = await orca.host.call('storage.get', { key: 'bindings.v1' })
      const bindings = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Project> : {}
      const tab = (await orca.host.call('storage.get', { key: 'tab' })).value === 'all' ? 'all' : 'mine'
      return { configured: !!config, url: config?.url ?? '', scope: key, binding: bindings[key] || null, tab }
    }
    orca.panels.handle('connection.read', state)
    orca.panels.handle('connection.save', async input => {
      if (saving) throw Error('Settings are being saved. Please wait.')
      saving = true
      try {
        const previous = await saved(), url = normalizeServer(input.url)
        const config = connection('mantisbt', { url, token: input.token || (previous?.url === url ? previous.token : '') })
        // Original source saves locally; later source reads surface offline/authentication errors.
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
        if (await scope() !== input.scope) throw Error('Workspace or server changed. Choose the project again.')
        const project = await (await api()).projectInfo(input.id)
        if (await scope() !== input.scope) throw Error('Workspace or server changed. Choose the project again.')
        const { value } = await orca.host.call('storage.get', { key: 'bindings.v1' })
        const bindings = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Project> : {}
        await orca.host.call('storage.set', { key: 'bindings.v1', value: { ...bindings, [input.scope]: project } })
        return project
      } finally { saving = false }
    })
    orca.panels.handle('view.save', async input => {
      if (!['mine', 'all'].includes(input.tab)) throw Error('Invalid MantisBT view.')
      await orca.host.call('storage.set', { key: 'tab', value: input.tab }); return { ok: true }
    })
    orca.panels.handle('projects.list', async input => (await api()).projects(null, input?.query ?? ''))
    orca.panels.handle('issues.subtasks', async input => (await api()).subtasks(input.id))
    orca.panels.handle('issues.detail', async input => (await api()).detail(input.id))
    orca.panels.handle('issues.list', async input => (await api()).issues(input.project, input.cursor ?? null, input.tab ?? 'mine'))
  }
}
export default createWorker()
