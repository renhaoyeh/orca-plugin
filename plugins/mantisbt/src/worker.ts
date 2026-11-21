import type { OrcaWorkerApi } from 'orca/worker'
import type { ConnectionState, FieldOption, Issue, IssueDetail, Page, Project } from './protocol'
import { storageKey } from './storage-key.mjs'
import { normalizeLayout } from './fields'
import { installedAgents, launchAgent, runOrcaCli } from './agent-launch.mjs'
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
  projectFields(id: string): Promise<FieldOption[]>
  issues(project: string, cursor: string | null, tab: 'mine' | 'all'): Promise<Page<Issue>>
  detail(id: string): Promise<IssueDetail>
  subtasks(id: string): Promise<Issue[]>
}

export function createWorker(
  makeClient: (kind: 'mantisbt', config: ReturnType<typeof connection>) => MantisClient = mantisClient,
  readScope = workspaceScope,
  runCli: (args: string[]) => Promise<any> = runOrcaCli,
) {
  return async function activate(orca: OrcaWorkerApi) {
    async function agentWorkspace(expectedWorkspaceId?: string) {
      const context = await orca.host.call('workspace.readContext', {})
      const workspaceId = context?.workspaceId
      if (!workspaceId) throw Error('Open a workspace before launching an Agent.')
      if (expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId) throw Error('Workspace changed. Reopen MantisBT before launching an Agent.')
      const list = await orca.host.call('workspace.list', {})
      if (list.truncated) throw Error('Workspace list is incomplete. Cannot safely launch an Agent.')
      const workspace = list.workspaces.find(row => row.id === workspaceId)
      if (!workspace) throw Error('Workspace changed. Reopen MantisBT before launching an Agent.')
      return workspace.id
    }
    let saving = false
    const maxAge = 2 * 60_000
    const issues = requestCache<Page<Issue>>(maxAge, 24)
    const details = requestCache<IssueDetail>(maxAge)
    const subtasks = requestCache<Issue[]>(maxAge)
    const selectionWrites = new Map<string, Promise<unknown>>()
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
    async function fieldProject(input: { url: string; project: string }) {
      const config = await saved()
      if (!config || config.url !== input.url) throw Error('Workspace or server changed. Choose the project again.')
      if (!/^\d+$/.test(input.project)) throw Error('Invalid MantisBT ID.')
      return config
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
    orca.panels.handle('fields.read', async input => {
      const config = await fieldProject(input)
      const { value } = await orca.host.call('storage.get', { key: storageKey('fields', config.url, input.project) })
      return normalizeLayout(value)
    })
    orca.panels.handle('fields.catalog', async input => makeClient('mantisbt', await fieldProject(input)).projectFields(input.project))
    orca.panels.handle('fields.save', async input => {
      const config = await fieldProject(input)
      const layout = normalizeLayout(input.layout)
      await orca.host.call('storage.set', { key: storageKey('fields', config.url, input.project), value: layout })
      return layout
    })
    orca.panels.handle('issues.selection.read', async input => {
      const key = storageKey('issue-selection', input.scope, input.project)
      await selectionWrites.get(key)?.catch(() => {})
      const { value } = await orca.host.call('storage.get', { key })
      return { id: typeof value === 'string' && /^\d+$/.test(value) ? value : null }
    })
    orca.panels.handle('issues.selection.save', async input => {
      if (input.id !== null && (typeof input.id !== 'string' || !/^\d+$/.test(input.id))) throw Error('Invalid MantisBT ID.')
      // Use the originating panel's scope even if the workspace has just changed.
      const key = storageKey('issue-selection', input.scope, input.project)
      const previous = selectionWrites.get(key) ?? Promise.resolve()
      const write = previous.catch(() => {}).then(() => orca.host.call('storage.set', { key, value: input.id }))
      selectionWrites.set(key, write)
      try { await write }
      finally { if (selectionWrites.get(key) === write) selectionWrites.delete(key) }
      return { ok: true as const }
    })
    orca.panels.handle('issues.subtasks', input => subtasks.load(input.id, async () => (await api()).subtasks(input.id)))
    orca.panels.handle('issues.detail', input => details.load(input.id, async () => (await api()).detail(input.id), detail => !detail.commentsError))
    orca.panels.handle('issues.list', input => {
      const { project, cursor = null, tab = 'mine' } = input
      return issues.load(JSON.stringify([project, cursor, tab]), async () => (await api()).issues(project, cursor, tab))
    })
    orca.panels.handle('agent.options', async () => {
      if (!orca.grantedCapabilities.includes('agent:launch')) throw Error('Allow Agent launch in this plugin\'s access review first.')
      const workspaceId = await agentWorkspace()
      return { workspaceId, agents: await installedAgents(runCli, workspaceId) }
    })
    orca.panels.handle('agent.launch', async input => {
      if (!orca.grantedCapabilities.includes('agent:launch')) throw Error('Allow Agent launch in this plugin\'s access review first.')
      if (typeof input?.workspaceId !== 'string' || typeof input.agent !== 'string' || typeof input.prompt !== 'string' || !input.prompt.trim()) throw Error('Choose an Agent and review its issue prompt.')
      return launchAgent(runCli, await agentWorkspace(input.workspaceId), input.agent, input.prompt)
    })
  }
}
export default createWorker()
