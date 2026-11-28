import type { PluginBridgeApi } from 'orca/host'
import type { ConnectionState, Project, Issue, IssueDetail, Page } from './protocol'

export function createPanelState(request: PluginBridgeApi['request'], changed: () => void) {
  const state = {
    config: null as ConnectionState | null, settings: false, busy: false, problem: '', paginationFailed: false, status: '',
    token: '', projects: [] as Project[], project: null as Project | null, picker: true, projectQuery: '',
    issues: [] as Issue[], next: null as string | null, query: '', tab: 'mine' as 'mine' | 'all',
    showSubtasks: true, subtasks: new Map<string, Issue[]>(), subtasksLoading: new Set<string>(), subtasksErrors: new Map<string, string>(),
    detailId: '', detail: null as IssueDetail | null, children: [] as Issue[],
    history: [] as { detail: IssueDetail; children: Issue[] }[],
    collapsedSections: new Set<string>(),
  }
  const cache = new Map<string, Page<Issue>>()
  let generation = 0
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSearch = false
  let pendingSave = false
  let workspaceChanged = false
  let preferenceWrite = 0
  let savedShowSubtasks = true
  let preferencePending = false
  let preferenceQueue = Promise.resolve()
  let subtaskEpoch = 0
  let activeSubtaskLoads = 0
  const subtaskQueue: { id: string; project: string; epoch: number; resolve: () => void }[] = []
  const subtaskInflight = new Map<string, Promise<void>>()
  function clearSubtaskState() {
    subtaskEpoch++
    for (const job of subtaskQueue.splice(0)) {
      subtaskInflight.delete(`${job.epoch}\0${job.project}\0${job.id}`)
      job.resolve()
    }
    state.subtasks.clear()
    state.subtasksLoading.clear()
    state.subtasksErrors.clear()
    changed()
  }
  function pumpSubtasks() {
    while (activeSubtaskLoads < 4 && subtaskQueue.length) {
      const job = subtaskQueue.shift()!
      if (job.epoch !== subtaskEpoch || job.project !== state.project?.id) continue
      activeSubtaskLoads++
      const key = `${job.epoch}\0${job.project}\0${job.id}`
      void (async () => {
        let changedCurrent = false
        try {
          const items = await request('issues.subtasks', { id: job.id })
          if (job.epoch === subtaskEpoch && job.project === state.project?.id) { state.subtasks.set(job.id, items); changedCurrent = true }
        } catch (error) {
          if (job.epoch === subtaskEpoch && job.project === state.project?.id) { state.subtasksErrors.set(job.id, error instanceof Error ? error.message : 'Could not load subtasks.'); changedCurrent = true }
        } finally {
          if (job.epoch === subtaskEpoch && job.project === state.project?.id) { state.subtasksLoading.delete(job.id); changedCurrent = true }
          activeSubtaskLoads--
          subtaskInflight.delete(key)
          job.resolve()
          if (changedCurrent) changed()
          pumpSubtasks()
        }
      })()
    }
  }
  function loadSubtasks(id: string, retry = false) {
    const project = state.project?.id
    if (!state.showSubtasks || !project || state.subtasks.has(id)) return Promise.resolve()
    const key = `${subtaskEpoch}\0${project}\0${id}`
    const existing = subtaskInflight.get(key)
    if (existing) return existing
    if (state.subtasksErrors.has(id) && !retry) return Promise.resolve()
    if (retry) state.subtasksErrors.delete(id)
    state.subtasksLoading.add(id)
    changed()
    let resolve!: () => void
    const pending = new Promise<void>(done => { resolve = done })
    subtaskInflight.set(key, pending)
    subtaskQueue.push({ id, project, epoch: subtaskEpoch, resolve })
    pumpSubtasks()
    return pending
  }
  function persistSelection(id: string | null) {
    const { workspaceId, scope, binding } = state.config || {}
    const project = state.project?.id
    if (workspaceId && scope && binding?.id === project && project) {
      void request('tasks.selection.save', { workspaceId, scope, project, id }).catch(() => {})
    }
  }

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
      persistSelection(null)
      patch({ picker: true, projectQuery: '', projects: [] })
      await loadProjects(current)
    })
  }

  function bindProject(project: Project) {
    if (state.project?.id === project.id) { patch({ picker: false }); return }
    clearSubtaskState()
    return run(async current => {
      const saved = await request('project.bind', { scope: state.config?.scope || 'source:asana', id: project.id })
      if (!current()) return
      patch({ config: state.config ? { ...state.config, binding: saved } : state.config, project: saved, picker: false, query: '', issues: [], next: null, collapsedSections: new Set() })
      persistSelection(null)
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
      persistSelection(id)
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
    persistSelection(previous?.detail.id ?? null)
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
      const oldConfig = state.config
      const saved = await request('connection.save', { url: '', token: state.token })
      if (!current()) return
      clearSubtaskState()
      cache.clear()
      const settings = !!oldConfig?.configured && state.settings
      patch({
        config: saved, token: '', status: 'Saved', settings, project: saved.binding ?? null,
        picker: !saved.binding, issues: [], next: null, detailId: '', detail: null, children: [], history: [],
      })
      persistSelection(null)
      if (!settings) await loadCurrent(current)
    })
  }

  function editToken(value: string) {
    patch({ token: value, status: '' })
    clearTimeout(saveTimer)
    if (value.trim()) saveTimer = setTimeout(() => { void saveToken() }, 650)
  }

  function loadCurrent(current: () => boolean) {
    if (state.detailId) return loadDetail(current, state.detailId)
    return state.picker ? loadProjects(current) : loadIssues(current)
  }

  function reload(force = false) {
    clearSubtaskState()
    return run(async current => {
      workspaceChanged = false
      const preferenceVersion = preferenceWrite
      const preferencePendingAtStart = preferencePending
      const saved = await request('connection.read')
      if (!current()) return
      const preservePreference = preferencePendingAtStart || preferenceWrite !== preferenceVersion
      const showSubtasks = preservePreference ? state.showSubtasks : saved.showSubtasks !== false
      if (!preservePreference) savedShowSubtasks = showSubtasks
      if (!force && state.config?.scope === saved.scope && state.config?.configured === saved.configured
        && state.project?.id === saved.binding?.id && state.tab === (saved.tab ?? 'mine')) {
        patch({ config: saved, showSubtasks })
        // Same-project workspace changes preserve the visible detail; associate
        // that displayed task with the newly resolved workspace snapshot.
        persistSelection(state.detailId || null)
        return
      }
      clearTimeout(searchTimer)
      pendingSearch = false
      cache.clear()
      patch({
        config: saved, settings: !saved.configured, token: '', status: '', project: saved.binding ?? null,
        tab: saved.tab ?? 'mine', showSubtasks, picker: !saved.binding, projects: [], projectQuery: '',
        detailId: '', detail: null, issues: [], next: null, query: '', children: [], history: [], collapsedSections: new Set(),
      })
      // The panel restores its project and task list, not an old detail view. Clear
      // the MCP selection on each fresh sidebar load so it always matches the UI.
      persistSelection(null)
      if (saved.configured) await loadCurrent(current)
    })
  }

  function onWorkspace(id: string | null) {
    if (state.config?.workspaceId === id) return
    if (state.config) workspaceChanged = true
    if (workspaceChanged && !state.settings) void reload()
  }

  function toggleSettings() {
    if (!state.settings) { patch({ settings: true, problem: '' }); return }
    if (!state.config?.configured) return
    patch({ settings: false })
    if (state.token.trim()) return saveToken()
    if (workspaceChanged) return reload()
    if (!state.status) return
    return run(loadCurrent)
  }

  function disconnect() {
    clearSubtaskState()
    return run(async current => {
      persistSelection(null)
      clearTimeout(saveTimer)
      const saved = await request('connection.remove')
      if (!current()) return
      cache.clear()
      patch({
        config: saved, token: '', status: 'Token cleared', project: null, projects: [], issues: [], next: null,
        detailId: '', detail: null, children: [], history: [], query: '', projectQuery: '', picker: true,
      })
    })
  }

  return {
    state, reload, onWorkspace, chooseProject, bindProject, searchProjects, selectTab, openTask, back,
    toggleSettings, editToken, saveToken, disconnect,
    setQuery: (query: string) => patch({ query }),
    loadSubtasks,
    retrySubtasks: (id: string) => loadSubtasks(id, true),
    toggleShowSubtasks() {
      const enabled = !state.showSubtasks
      const write = ++preferenceWrite
      preferencePending = true
      if (!enabled) clearSubtaskState()
      patch({ showSubtasks: enabled })
      preferenceQueue = preferenceQueue.catch(() => {}).then(async () => {
        await request('subtasks.preference.save', { enabled })
        savedShowSubtasks = enabled
        if (write === preferenceWrite) preferencePending = false
      }).catch(error => {
        if (write !== preferenceWrite) return
        preferencePending = false
        if (!savedShowSubtasks) clearSubtaskState()
        patch({ showSubtasks: savedShowSubtasks, problem: error instanceof Error ? error.message : 'Could not save the Show subtasks preference.' })
      })
    },
    toggleSection(section: string) {
      if (!state.collapsedSections.delete(section)) state.collapsedSections.add(section)
      changed()
    },
    refresh: () => { clearSubtaskState(); return run(async current => {
      await request('data.refresh')
      if (!current()) return
      cache.clear()
      await loadCurrent(current)
    }) },
    more: () => run(async current => {
      patch({ paginationFailed: false })
      try { await loadIssues(current, true) }
      catch (error) { patch({ paginationFailed: true }); throw error }
    }),
    dispose() {
      clearTimeout(searchTimer)
      clearTimeout(saveTimer)
      pendingSearch = false
      pendingSave = false
      clearSubtaskState()
      if (state.token.trim() && !state.busy) void request('connection.save', { url: '', token: state.token }).catch(() => {})
      generation++
    },
  }
}
