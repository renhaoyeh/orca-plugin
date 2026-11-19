import type { OrcaWorkerApi } from 'orca/worker'
import type { ConnectionState, Issue, IssueDetail, Page, Project } from './protocol'
import { requestCache } from './request-cache'
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
type MantisClient = {
  projects(cursor: null, query: string): Promise<Page<Project>>
  projectInfo(id: string): Promise<Project>
  issues(project: string, cursor: string | null, tab: 'mine' | 'all'): Promise<Page<Issue>>
  detail(id: string): Promise<IssueDetail>
  subtasks(id: string): Promise<Issue[]>
}

export function createWorker(
  makeClient: (kind: 'mantisbt', config: ReturnType<typeof connection>) => MantisClient = mantisClient,
  readScope = workspaceScope,
) {
  return async function activate(orca: OrcaWorkerApi) {
    let saving = false
    const maxAge = 2 * 60_000
    const issues = requestCache<Page<Issue>>(maxAge, 24)
    const details = requestCache<IssueDetail>(maxAge)
    const subtasks = requestCache<Issue[]>(maxAge)
    function clearRequests() {
      issues.clear()
      details.clear()
      subtasks.clear()
    }
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
    async function state(): Promise<ConnectionState> {
      const config = await saved(), key = JSON.stringify([await readScope(orca), config?.url || ''])
      const { value } = await orca.host.call('storage.get', { key: 'bindings.v1' })
      const bindings = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Project> : {}
      const tab = (await orca.host.call('storage.get', { key: 'tab' })).value === 'all' ? 'all' : 'mine'
      return { configured: !!config, url: config?.url ?? '', scope: key, binding: bindings[key] || null, tab }
    }
    orca.panels.handle('connection.read', state)
    orca.panels.handle('data.refresh', () => { clearRequests(); return { ok: true as const } })
    orca.panels.handle('connection.save', async input => {
      if (saving) throw Error('Settings are being saved. Please wait.')
      saving = true
      try {
        const previous = await saved(), url = normalizeServer(input.url)
        const config = connection('mantisbt', { url, token: input.token || (previous?.url === url ? previous.token : '') })
        // Original source saves locally; later source reads surface offline/authentication errors.
        await orca.host.call('secrets.set', { key: 'connection.v1', value: JSON.stringify(config) })
        clearRequests()
        return await state()
      } finally { saving = false }
    })
    orca.panels.handle('connection.remove', async () => {
      if (saving) throw Error('Settings are being saved. Please wait.')
      saving = true
      try {
        await orca.host.call('secrets.delete', { key: 'connection.v1' })
        clearRequests()
        return await state()
      }
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
      await orca.host.call('storage.set', { key: 'tab', value: input.tab }); return { ok: true as const }
    })
    orca.panels.handle('projects.list', async input => (await api()).projects(null, input?.query ?? ''))
    orca.panels.handle('issues.subtasks', input => subtasks.load(input.id, async () => (await api()).subtasks(input.id)))
    orca.panels.handle('issues.detail', input => details.load(input.id, async () => (await api()).detail(input.id), detail => !detail.commentsError))
    orca.panels.handle('issues.list', input => {
      const { project, cursor = null, tab = 'mine' } = input
      return issues.load(JSON.stringify([project, cursor, tab]), async () => (await api()).issues(project, cursor, tab))
    })
  }
}
export default createWorker()
