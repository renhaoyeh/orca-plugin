import type { PluginBridgeApi } from 'orca/host'
import type { ConnectionState, FieldLayout, FieldOption, Project, Issue, IssueDetail, Page } from './protocol'

export const filterFields = {
  reporter: 'Reporter', assignee: 'Assignee', status: 'Status', category: 'Category', priority: 'Priority', severity: 'Severity',
} as const
export type FilterKey = keyof typeof filterFields
type Filters = Partial<Record<FilterKey, string[]>>
export function filterValue(issue: Issue, key: FilterKey) {
  return (key === 'status' ? issue.section || issue.status : issue[key]) || ''
}

export function createPanelState(request: PluginBridgeApi['request'], changed: () => void) {
  const state = {
    config: null as ConnectionState | null, settings: false, busy: false, problem: '', status: '',
    server: '', token: '', projects: [] as Project[], project: null as Project | null, picker: true, projectQuery: '',
    issues: [] as Issue[], next: null as string | null, query: '', tab: 'mine' as 'mine' | 'all',
    detailId: '', detail: null as IssueDetail | null, children: [] as Issue[],
    history: [] as { detail: IssueDetail; children: Issue[] }[],
    collapsedSections: new Set<string>(),
    filters: {} as Filters, filtersOpen: false,
    fieldEditor: false, fieldLayout: {} as FieldLayout, fieldCatalog: null as FieldOption[] | null,
    fetchingAll: false, fetchPages: 0,
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
  let stopFetching = false
  const pageKey = (project: string) => JSON.stringify([project, state.tab])

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
    const key = pageKey(project)
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

  function fieldProject() {
    return state.project && state.config ? { project: state.project.id, url: state.config.url } : null
  }

  async function loadFieldLayout(current: () => boolean) {
    const input = fieldProject()
    if (!input) return
    const fieldLayout = await request('fields.read', input)
    if (current()) patch({ fieldLayout })
  }

  async function loadProject(current: () => boolean) {
    const results = await Promise.allSettled([loadIssues(current), loadFieldLayout(current)])
    for (const result of results) if (result.status === 'rejected') throw result.reason
  }

  function selectionContext() {
    const scope = state.config?.scope
    return state.project && scope ? { scope, project: state.project.id } : null
  }

  async function saveSelection(id: string | null) {
    const context = selectionContext()
    if (!context) return
    try { await request('issues.selection.save', { ...context, id }) }
    catch (error) {
      if (state.config?.scope === context.scope && state.project?.id === context.project && state.detailId === (id ?? '')) {
        patch({ problem: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  async function restoreProject(current: () => boolean) {
    const context = selectionContext()
    const { id } = context ? await request('issues.selection.read', context) : { id: null }
    if (!current()) return
    if (!id) return loadProject(current)
    patch({ detailId: id })
    const [detail, layout] = await Promise.allSettled([loadDetail(current, id), loadFieldLayout(current)])
    if (!current()) return
    if (detail.status === 'rejected') {
      const reason = detail.reason
      if (!(reason instanceof Error) || reason.message !== 'This issue was resolved or deleted in MantisBT.') throw reason
      patch({ detailId: '' })
      await Promise.all([saveSelection(null), loadIssues(current)])
      if (current()) patch({ problem: reason.message })
    }
    if (layout.status === 'rejected') throw layout.reason
  }

  function openFields() {
    return run(async current => {
      const input = fieldProject()
      if (!input) return
      patch({ fieldEditor: true })
      if (state.fieldCatalog) return
      const fieldCatalog = await request('fields.catalog', input)
      if (current()) patch({ fieldCatalog })
    })
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
      patch({ project: saved, picker: false, query: '', issues: [], next: null, collapsedSections: new Set(), filters: {}, fieldLayout: {}, fieldCatalog: null })
      await restoreProject(current)
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
      const saved = saveSelection(id)
      await loadDetail(current, id)
      await saved
    })
  }

  async function back(toList = false) {
    const hadDetail = !!state.detailId
    const previous = toList ? undefined : state.history.at(-1)
    // Stop applying results from the task that just left the screen.
    generation++
    patch({
      picker: false, busy: false, problem: '', history: toList ? [] : state.history.slice(0, -1),
      detailId: previous?.detail.id ?? '', detail: previous?.detail ?? null, children: previous?.children ?? [],
    })
    const saved = hadDetail ? saveSelection(previous?.detail.id ?? null) : undefined
    if (workspaceChanged) await reload()
    else if (hadDetail && !previous && state.project && !cache.has(pageKey(state.project.id))) await run(loadProject)
    await saved
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
        detailId: '', detail: null, children: [], history: [], collapsedSections: new Set(), filters: {}, fieldEditor: false, fieldLayout: {}, fieldCatalog: null,
      })
      if (!state.settings) await loadConnection(current)
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
    return state.picker ? loadProjects(current) : loadProject(current)
  }

  function loadConnection(current: () => boolean) {
    return state.picker ? loadProjects(current) : restoreProject(current)
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
        filters: {}, fieldEditor: false, fieldLayout: {}, fieldCatalog: null,
      })
      if (saved.configured) await loadConnection(current)
    })
  }

  function onWorkspace(id: string | null) {
    if (workspace === id) return
    if (workspace !== undefined) workspaceChanged = true
    workspace = id
    if (workspaceChanged && state.fetchingAll) stopFetching = true
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
    if (reloadContent) return run(loadConnection)
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
        filters: {}, fieldEditor: false, fieldLayout: {}, fieldCatalog: null,
      })
    })
  }

  function fetchAll() {
    if (state.tab !== 'all' || !state.project || !state.next) return
    return run(async current => {
      stopFetching = false
      patch({ fetchingAll: true, fetchPages: 0 })
      const visited = new Set<string>()
      try {
        while (current() && !stopFetching && state.next) {
          if (visited.has(state.next)) throw Error('MantisBT returned a repeated page. Try refreshing.')
          visited.add(state.next)
          await loadIssues(() => current() && !stopFetching, true)
          if (current() && !stopFetching) patch({ fetchPages: state.fetchPages + 1 })
        }
      } catch (error) {
        if (!stopFetching) throw error
      } finally {
        if (current()) patch({ fetchingAll: false })
      }
    })
  }

  return {
    state, reload, onWorkspace, chooseProject, bindProject, searchProjects, selectTab, openTask, back,
    toggleSettings, editServer, editToken, saveToken, disconnect,
    setQuery: (query: string) => patch({ query }),
    toggleFilters: () => patch({ filtersOpen: !state.filtersOpen }),
    clearFilters: () => patch({ filters: {} }),
    toggleFilter(key: FilterKey, value: string) {
      const selected = new Set(state.filters[key])
      if (!selected.delete(value)) selected.add(value)
      patch({ filters: { ...state.filters, [key]: [...selected] } })
    },
    openFields,
    closeFields: () => patch({ fieldEditor: false, problem: '' }),
    saveFields: (layout: FieldLayout) => run(async current => {
      const input = fieldProject()
      if (!input) return
      const fieldLayout = await request('fields.save', { ...input, layout })
      if (current()) patch({ fieldLayout, fieldEditor: false })
    }),
    toggleSection(section: string) {
      if (!state.collapsedSections.delete(section)) state.collapsedSections.add(section)
      changed()
    },
    refresh: () => run(async current => {
      await request('data.refresh')
      if (!current()) return
      cache.clear()
      patch({ fieldCatalog: null })
      await loadCurrent(current)
    }),
    more: () => run(current => loadIssues(current, true)),
    fetchAll,
    stopFetchAll: () => { stopFetching = true },
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
