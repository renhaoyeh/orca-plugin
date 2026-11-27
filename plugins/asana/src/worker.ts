import type { OrcaWorkerApi } from 'orca/worker'
import type { ConnectionState, Issue, IssueDetail, Page, Project } from './protocol'
import { requestCache } from './request-cache'
import { asanaClient } from './asana-client.mjs'
import { connection } from './api.mjs'
import { installedAgents, launchAgent, runOrcaCli } from './agent-launch.mjs'
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
type AsanaClient = {
  projects(cursor: null, query: string): Promise<Page<Project>>
  projectInfo(id: string): Promise<Project>
  issues(project: string, cursor: string | null, scope: 'mine' | 'all'): Promise<Page<Issue>>
  detail(id: string, project?: string): Promise<IssueDetail>
  subtasks(id: string): Promise<Issue[]>
}
type McpCaller = { cwd: string; workspaceId?: string }
function mcpSelectionKey(workspaceId: string, scope: string, project: string) { return `asana-current-task:${JSON.stringify([workspaceId, scope, project])}` }

export function createWorker(
  makeClient: (kind: 'asana', config: ReturnType<typeof connection>) => AsanaClient = asanaClient,
  readScope = workspaceScope,
  runCli: (args: string[]) => Promise<any> = runOrcaCli,
  startBridge?: (api: () => Promise<AsanaClient>, currentTask: (caller: McpCaller) => Promise<IssueDetail | null>) => Promise<() => Promise<void>>,
) {
  return async function activate(orca: OrcaWorkerApi) {
    async function agentWorkspace(expectedWorkspaceId?: string) {
      const context = await orca.host.call('workspace.readContext', {})
      const workspaceId = context?.workspaceId
      if (!workspaceId) throw Error('Open a workspace before launching an Agent.')
      if (expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId) throw Error('Workspace changed. Reopen Asana before launching an Agent.')
      const list = await orca.host.call('workspace.list', {})
      if (list.truncated) throw Error('Workspace list is incomplete. Cannot safely launch an Agent.')
      const workspace = list.workspaces.find(row => row.id === workspaceId)
      if (!workspace) throw Error('Workspace changed. Reopen Asana before launching an Agent.')
      return workspace.id
    }
    let saving = false
    const maxAge = 2 * 60_000
    const projects = requestCache<Page<Project>>(maxAge, 32)
    const issues = requestCache<Page<Issue>>(maxAge, 24)
    const details = requestCache<IssueDetail>(maxAge)
    const subtasks = requestCache<Issue[]>(maxAge)
    const selectionWrites = new Map<string, Promise<unknown>>()
    function clearRequests() {
      projects.clear(); issues.clear(); details.clear(); subtasks.clear()
    }
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
    async function state(): Promise<ConnectionState> {
      const config = await saved(), scope = await readScope(orca)
      const { value } = await orca.host.call('storage.get', { key: 'bindings.v1' })
      const bindings = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Project> : {}
      const tab = (await orca.host.call('storage.get', { key: 'tab' })).value === 'all' ? 'all' : 'mine'
      return { configured: !!config, url: config?.url ?? '', scope, binding: bindings[scope] || null, tab }
    }
    orca.panels.handle('connection.read', state)
    orca.panels.handle('data.refresh', () => { clearRequests(); return { ok: true as const } })
    orca.panels.handle('connection.save', async input => {
      if (saving) throw Error('Settings are being saved. Please wait.')
      saving = true
      try {
        const previous = await saved()
        const config = connection('asana', { token: input.token || previous?.token })
        // Original AsanaSource saves a nonempty token; API reads report authentication errors.
        await orca.host.call('secrets.set', { key: 'connection.v1', value: JSON.stringify(config) })
        clearRequests()
        return await state()
      } finally { saving = false }
    })
    orca.panels.handle('connection.remove', async () => {
      if (saving) throw Error('Settings are being saved. Please wait.')
      saving = true
      try { await orca.host.call('secrets.delete', { key: 'connection.v1' }); clearRequests(); return await state() }
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
      return { ok: true as const }
    })
    orca.panels.handle('projects.list', input => {
      const query = input?.query ?? ''
      return projects.load(query, async () => (await api()).projects(null, query))
    })
    orca.panels.handle('issues.subtasks', input => subtasks.load(input.id, async () => (await api()).subtasks(input.id)))
    orca.panels.handle('issues.detail', input => details.load(JSON.stringify([input.project, input.id]),
      async () => (await api()).detail(input.id, input.project), detail => !detail.commentsError && !detail.images?.length))
    orca.panels.handle('tasks.selection.save', async input => {
      if (typeof input?.workspaceId !== 'string' || typeof input.scope !== 'string' || typeof input.project !== 'string' || (input.id !== null && typeof input.id !== 'string')) throw Error('Invalid Asana task selection.')
      const key = mcpSelectionKey(input.workspaceId, input.scope, input.project)
      const previous = selectionWrites.get(key) ?? Promise.resolve()
      const write = previous.catch(() => {}).then(() => orca.host.call('storage.set', { key, value: input.id }))
      selectionWrites.set(key, write)
      try { await write } finally { if (selectionWrites.get(key) === write) selectionWrites.delete(key) }
      return { ok: true as const }
    })
    orca.panels.handle('images.preview', async input => (await api()).image(input.id))
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
      if (typeof input?.workspaceId !== 'string' || typeof input.agent !== 'string' || typeof input.prompt !== 'string' || !input.prompt.trim()) throw Error('Choose an Agent and review its task prompt.')
      return launchAgent(runCli, await agentWorkspace(input.workspaceId), input.agent, input.prompt)
    })
    if (startBridge) {
      orca.hooks.on('agent.launch.before', (event, next) => event.workspaceId
        ? next({ ...event, env: { ...event.env, ASANA_ORCA_WORKSPACE_ID: event.workspaceId } }) : next(event))
      return startBridge(api, async caller => {
        const { workspaces, truncated } = await orca.host.call('workspace.list', {})
        if (truncated) throw Error('Workspace list is incomplete. Cannot safely read the selected Asana task.')
        const normalized = (value: string) => { const path = value.replace(/\\/g, '/').replace(/\/+$/, '') || '/'; return process.platform === 'win32' ? path.toLowerCase() : path }
        const matches = workspaces.filter(row => (!row.hostId || row.hostId === 'local') && normalized(row.path) === normalized(caller.cwd))
        const workspace = matches.find(row => row.id === caller.workspaceId) ?? (matches.length === 1 ? matches[0] : undefined)
        if (!workspace) throw Error('Open this Agent in an unambiguous Orca workspace on the same host to read the selected Asana task.')
        const list = await orca.host.call('project.list', {})
        if (list.truncated) throw Error('Project list is incomplete. Cannot safely read the selected Asana task.')
        const project = list.projects.find(item => item.id === workspace.projectId)
        const scope = JSON.stringify([project?.hostId || workspace.hostId || 'local', (project?.path || workspace.path).replace(/\\/g, '/').replace(/\/+$/, '')])
        const { value: binding } = await orca.host.call('storage.get', { key: 'bindings.v1' })
        const bound = binding && typeof binding === 'object' ? (binding as Record<string, Project>)[scope] : null
        if (!bound) return null
        const key = mcpSelectionKey(workspace.id, scope, bound.id)
        await selectionWrites.get(key)?.catch(() => {})
        const { value: selected } = await orca.host.call('storage.get', { key })
        if (typeof selected !== 'string' || !selected) return null
        const config = await saved()
        if (!config) throw Error('Connect an Asana API token first.')
        const detail = await makeClient('asana', config).detail(selected, bound.id)
        const again = await orca.host.call('workspace.readContext', {})
        if (caller.workspaceId && again?.workspaceId !== caller.workspaceId) throw Error('Workspace changed while reading the Asana task. Retry the request.')
        const [{ value: stillSelected }, currentConfig] = await Promise.all([
          orca.host.call('storage.get', { key }), saved(),
        ])
        if (stillSelected !== selected || !currentConfig || currentConfig.token !== config.token) throw Error('Asana selection or connection changed while reading. Retry the request.')
        return detail
      })
    }
  }
}
let closeBridge: (() => Promise<void>) | undefined
export default async function activate(orca: OrcaWorkerApi) {
  closeBridge = await createWorker(undefined, undefined, undefined, async (api, currentTask) => {
    try { const { startMcpBridge } = await import('../mcp/bridge.mjs'); return await startMcpBridge(api, currentTask) }
    catch (cause) { const reason = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : 'bridge startup failed'; orca.log(`Asana MCP could not start (${reason}). Check MCP dependencies and reload the plugin.`); return async () => {} }
  })(orca)
}
export async function deactivate() { await closeBridge?.() }
