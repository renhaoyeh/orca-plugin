import type { PluginBridgeApi } from 'orca/host'
import type { ConnectionState, Project, Issue, IssueDetail, Page } from './protocol'

export function createPanelState(request: PluginBridgeApi['request'], changed: () => void) {
  const state = {
    config: null as ConnectionState | null, settings: false, busy: false, problem: '', status: '',
    server: '', token: '', projects: [] as Project[], project: null as Project | null, picker: true, projectQuery: '',
    issues: [] as Issue[], next: null as string | null, query: '', tab: 'mine' as 'mine' | 'all',
    detailId: '', detail: null as IssueDetail | null, children: [] as Issue[],
    history: [] as { detail: IssueDetail; children: Issue[] }[],
    collapsedSections: new Set<string>(),
  }
  const cache = new Map<string, Page<Issue>>()
  let generation = 0
  let workspace: string | null | undefined
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSearch = false
  let pendingSave = false
  let workspaceChanged = false
  let connectionChanged = false

  function patch(values: Partial<typeof state>) {
    Object.assign(state, values)
    changed()
  }

  async function run(action: (current: () => boolean) => Promise<void>) {
    if (state.busy) return
    const active = ++generation
    const current = () => active === generation
    patch({ busy: true, problem: '' })
    try {
      await action(current)
    } catch (error) {
      if (current()) patch({ problem: error instanceof Error ? error.message : String(error) })
    } finally {
      if (current()) {
        patch({ busy: false })
        if (workspaceChanged && !state.settings) await reload()
        else if (pendingSave) { pendingSave = false; await saveToken() }
        else if (pendingSearch && state.picker && !state.settings) {
          pendingSearch = false
          await run(loadProjects)
        }
      }
    }
  }

  async function loadProjects(current: () => boolean) {
    const query = state.projectQuery
    const page = await request('projects.list', { cursor: null, query })
    if (current() && query === state.projectQuery) patch({ projects: page.items })
  }

  function searchProjects(value: string, immediate = false) {
    patch({ projectQuery: value })
    clearTimeout(searchTimer)
    const search = () => {
      if (!state.picker || state.settings) return
      if (state.busy) pendingSearch = true
      else void run(loadProjects)
    }
    if (immediate) search()
    else searchTimer = setTimeout(search, 350)
  }

  async function loadIssues(current: () => boolean, more = false) {
    const project = state.project?.id
    if (!project) return
    const key = JSON.stringify([project, state.tab])
    const cached = cache.get(key)
    if (!more && cached) {
      patch({ issues: cached.items, next: cached.next })
      return
    }
    const page = await request('issues.list', { project, cursor: more ? state.next : null, tab: state.tab })
    if (!current()) return
    const items = more ? [...new Map([...state.issues, ...page.items].map(issue => [issue.id, issue])).values()] : page.items
    cache.set(key, { items, next: page.next })
    patch({ issues: items, next: page.next })
  }

  function chooseProject() {
    return run(async current => {
      patch({ picker: true, projectQuery: '', projects: [] })
      await loadProjects(current)
    })
  }

  function bindProject(project: Project) {
    if (state.project?.id === project.id) { patch({ picker: false }); return }
    return run(async current => {
      const scope = state.config?.scope
      if (!scope) return
      const saved = await request('project.bind', { scope, id: project.id })
      if (!current()) return
      patch({ project: saved, picker: false, query: '', issues: [], next: null, collapsedSections: new Set() })
      await loadIssues(current)
    })
  }

  function selectTab(tab: typeof state.tab) {
    if (state.tab === tab) return
    return run(async current => {
      await request('view.save', { tab })
      if (!current()) return
      patch({ tab, issues: [], next: null })
      await loadIssues(current)
    })
  }

  async function loadDetail(current: () => boolean, id: string) {
    const detail = await request('issues.detail', { id, project: state.project?.id })
    if (!current()) return
    patch({ detail })
    if (detail.subtasks) {
      const children = await request('issues.subtasks', { id })
      if (current()) patch({ children })
    }
  }

  function openTask(id: string) {
    if (id === state.detailId) return
    return run(async current => {
      const { detail, children, history } = state
      patch({
        detailId: id, detail: null, children: [],
        history: detail ? [...history.slice(-29), { detail, children }] : history,
      })
      await loadDetail(current, id)
    })
  }

  function back(toList = false) {
    const previous = toList ? undefined : state.history.at(-1)
    // Stop applying results from the task that just left the screen.
    generation++
    patch({
      picker: false, busy: false, problem: '', history: toList ? [] : state.history.slice(0, -1),
      detailId: previous?.detail.id ?? '', detail: previous?.detail ?? null, children: previous?.children ?? [],
    })
    if (workspaceChanged) void reload()
  }

  async function saveToken() {
    clearTimeout(saveTimer)
    if (!state.token.trim()) return
    if (state.busy) { pendingSave = true; return }
    await run(async current => {
      const saved = await request('connection.save', { url: state.server.trim(), token: state.token })
      if (!current()) return
      cache.clear()
      connectionChanged = true
      patch({
        config: saved, server: saved.url, token: '', status: 'Saved', project: saved.binding ?? null,
        picker: !saved.binding, projects: [], projectQuery: '', query: '', issues: [], next: null,
        detailId: '', detail: null, children: [], history: [], collapsedSections: new Set(),
      })
      if (!state.settings) await loadCurrent(current)
    })
  }

  function editToken(value: string) {
    patch({ token: value, status: '' })
    clearTimeout(saveTimer)
    if (value.trim()) saveTimer = setTimeout(() => { void saveToken() }, 650)
  }

  function editServer(server: string) {
    patch({ server })
    editToken(state.token)
  }

  function loadCurrent(current: () => boolean) {
    if (state.detailId) return loadDetail(current, state.detailId)
    return state.picker ? loadProjects(current) : loadIssues(current)
  }

  function reload(force = false) {
    return run(async current => {
      workspaceChanged = false
      const saved = await request('connection.read')
      if (!current()) return
      if (!force && state.config?.scope === saved.scope && state.config?.configured === saved.configured
        && state.project?.id === saved.binding?.id && state.tab === (saved.tab ?? 'mine')) {
        patch({ config: saved })
        return
      }
      clearTimeout(searchTimer)
      pendingSearch = false
      cache.clear()
      patch({
        config: saved, server: saved.url, settings: !saved.configured, token: '', status: '', project: saved.binding ?? null,
        tab: saved.tab ?? 'mine', picker: !saved.binding, projects: [], projectQuery: '',
        detailId: '', detail: null, issues: [], next: null, query: '', children: [], history: [], collapsedSections: new Set(),
      })
      if (saved.configured) await loadCurrent(current)
    })
  }

  function onWorkspace(id: string | null) {
    if (workspace === id) return
    if (workspace !== undefined) workspaceChanged = true
    workspace = id
    if (workspaceChanged && !state.settings) void reload()
  }

  function toggleSettings() {
    if (!state.settings) { patch({ settings: true, problem: '' }); return }
    if (!state.config?.configured) return
    if (state.token.trim()) return saveToken()
    patch({ settings: false, server: state.config.url, status: '', problem: '' })
    const reloadContent = connectionChanged
    connectionChanged = false
    if (workspaceChanged) return reload()
    if (reloadContent) return run(loadCurrent)
  }

  function disconnect() {
    return run(async current => {
      clearTimeout(saveTimer)
      const saved = await request('connection.remove')
      if (!current()) return
      cache.clear()
      patch({
        config: saved, server: saved.url, token: '', status: 'Token cleared', project: null, projects: [], issues: [], next: null,
        detailId: '', detail: null, children: [], history: [], query: '', projectQuery: '', picker: true,
      })
    })
  }

  return {
    state, reload, onWorkspace, chooseProject, bindProject, searchProjects, selectTab, openTask, back,
    toggleSettings, editServer, editToken, saveToken, disconnect,
    setQuery: (query: string) => patch({ query }),
    toggleSection(section: string) {
      if (!state.collapsedSections.delete(section)) state.collapsedSections.add(section)
      changed()
    },
    refresh: () => run(async current => {
      await request('data.refresh')
      if (!current()) return
      cache.clear()
      await loadCurrent(current)
    }),
    more: () => run(current => loadIssues(current, true)),
    dispose() {
      clearTimeout(searchTimer)
      clearTimeout(saveTimer)
      pendingSearch = false
      pendingSave = false
      if (state.token.trim() && !state.busy) void request('connection.save', { url: state.server.trim(), token: state.token }).catch(() => {})
      generation++
    },
  }
}
