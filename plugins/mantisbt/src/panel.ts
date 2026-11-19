import type {} from 'orca/frame'
import type { Issue, IssueDetail } from './protocol'
import { localeOf, translate, translateError } from './i18n'
import { statusColor, issueNumber, priorityTone, fieldTone, dueTone, dateLabel } from './presentation'
import { createPanelState } from './panel-state'

const icons = {
  refresh: 'M16 7a6 6 0 1 0 .5 5M16 3v4h-4',
  settings: 'M3 5h14M3 10h14M3 15h14M7 3v4m6 1v4m-5 1v4',
  search: 'M13.5 13.5 17 17M15 8.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  folder: 'M2 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z',
  down: 'm5 8 5 5 5-5',
  right: 'm8 5 5 5-5 5',
  back: 'm9 5-5 5 5 5m-5-5h12',
  close: 'm5 5 10 10M15 5 5 15',
  external: 'M11 3h6v6m0-6-7 7m6 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5',
  subtasks: 'M5 3v11a2 2 0 0 0 2 2h3M5 8h5m1-2h5v4h-5zm0 8h5v4h-5z',
  person: 'M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM4 16a6 6 0 0 1 12 0',
}

function icon(name: keyof typeof icons) {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(namespace, 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(namespace, 'path')
  path.setAttribute('d', icons[name])
  svg.append(path)
  return svg
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: (Node | string)[]) {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...children)
  return node
}

type Action = () => unknown
function button(className: string, action: Action, ...children: (Node | string)[]) {
  const node = element('button', className, ...children)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}

const frame = window.orca
const locale = localeOf(frame.locale)
document.documentElement.lang = frame.locale || locale
const t = (key: string, values?: Record<string, number>) => translate(key, locale, values)
const formatDate = (date: string) => dateLabel(date, locale)

function iconButton(name: keyof typeof icons, label: string, action: Action) {
  const node = button('icon-button', action, icon(name))
  node.title = label
  node.setAttribute('aria-label', label)
  return node
}

function searchField(label: string, onInput: (value: string) => void, onSubmit?: (value: string) => void) {
  const input = element('input', 'search-input')
  input.type = 'search'
  input.placeholder = label
  input.setAttribute('aria-label', label)
  input.addEventListener('input', () => onInput(input.value))
  const form = element('form', 'search-field', icon('search'), input)
  form.addEventListener('submit', event => {
    event.preventDefault()
    onSubmit?.(input.value)
  })
  return { input, form }
}

function skeleton(view: 'tasks' | 'detail' | 'projects', count = 3) {
  const shape = element('div', `skeleton skeleton--${view}`)
  shape.setAttribute('role', 'status')
  shape.setAttribute('aria-label', t('Loading'))
  for (let row = 0; row < count; row++) {
    shape.append(element('div', 'skeleton-row', element('span', 'skeleton-mark'), element('span', 'skeleton-bar'), element('span', 'skeleton-bar')))
  }
  return shape
}

function statusSwatch(issue: Issue) {
  const swatch = element('span', 'status-swatch')
  swatch.style.backgroundColor = statusColor(issue)
  swatch.setAttribute('aria-hidden', 'true')
  return swatch
}

const model = createPanelState(frame.plugin.request.bind(frame.plugin), scheduleRender)
const { state } = model
const logo = element('img', 'brand-mark')
logo.src = '../assets/mantisbt.png'
logo.alt = ''
const brand = element('div', 'brand', logo, 'MantisBT')
const refresh = iconButton('refresh', t('Refresh'), () => model.refresh())
const settings = iconButton('settings', t('Connection settings'), () => model.toggleSettings())
const bar = element('header', 'panel-bar', brand, element('div', 'actions', refresh, settings))
const error = element('div', 'error')
error.setAttribute('role', 'alert')
const main = element('main', 'panel-main')
document.querySelector('#app')!.append(bar, error, main)

function taskRow(issue: Issue) {
  const row = button('task-row', () => {
    if (screen === 'tasks') listTask = issue.id
    return model.openTask(issue.id)
  })
  row.dataset.focus = `task-${issue.id}`
  row.disabled = state.busy
  const summary = element('span', 'task-summary', issue.title)
  const number = element('span', 'issue-id', issueNumber(issue.id))
  const metadata = element('span', 'row-meta')
  for (const value of [issue.assignee || t('Unassigned'), issue.category, issue.severity]) {
    if (value) metadata.append(element('span', '', value))
  }
  if (issue.priority) metadata.append(element('span', `tone-${priorityTone(issue.priorityId)}`, issue.priority))
  if (issue.updatedAt) metadata.append(element('span', '', formatDate(issue.updatedAt)))
  if (issue.due) metadata.append(element('span', `tone-${dueTone(issue.due)}`, `${t('Due date')} · ${formatDate(issue.due)}`))
  if (issue.noteCount) metadata.append(element('span', '', t('{count} notes', { count: issue.noteCount })))
  if (issue.subtasks) {
    const label = t(issue.subtasks === 1 ? '{count} subtask' : '{count} subtasks', { count: issue.subtasks })
    const count = element('span', 'subtask-count', icon('subtasks'), String(issue.subtasks))
    count.title = label
    count.setAttribute('aria-label', label)
    metadata.append(count)
  }
  const status = issue.section || issue.status
  row.append(number, summary, element('span', 'row-status', statusSwatch(issue), status), metadata)
  return row
}

function taskTable() {
  const head = element('div', 'list-head', element('span', '', 'ID'), element('span', '', t('Summary')), element('span', '', t('Status')))
  const rows = element('div', 'task-groups')
  const filter = searchField(t('Filter issues'), model.setQuery)
  const projectLabel = element('span', 'project-name')
  const chooser = button('project-button', () => model.chooseProject(), element('span', 'project-mark', icon('folder')), projectLabel, icon('down'))
  chooser.title = t('Choose MantisBT project')
  const mine = button('view-button', () => model.selectTab('mine'), t('Mine'))
  const all = button('view-button', () => model.selectTab('all'), t('All'))
  const viewBar = element('nav', 'view-bar', mine, all)
  viewBar.setAttribute('aria-label', t('Issue views'))
  const more = button('more-button', () => model.more(), t('Load more'))
  const title = element('h1', 'widget-title')
  const list = element('section', 'widget issue-widget', title, head, rows, more)
  main.append(element('div', 'project-header', chooser), viewBar, element('div', 'filters', filter.form), list)
  return () => {
    projectLabel.textContent = state.project?.name || t('Choose MantisBT project')
    title.textContent = t(state.tab === 'mine' ? 'Assigned to Me' : 'Viewing Issues')
    chooser.disabled = mine.disabled = all.disabled = more.disabled = state.busy
    mine.setAttribute('aria-pressed', String(state.tab === 'mine'))
    all.setAttribute('aria-pressed', String(state.tab === 'all'))
    if (filter.input.value !== state.query) filter.input.value = state.query
    more.hidden = !state.next || state.tab !== 'all'
    const words = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    const groups = new Map<string, Issue[]>()
    for (const issue of state.issues) {
      const text = [issue.id, issueNumber(issue.id), issue.title, issue.assignee, issue.section, issue.category].join(' ').toLowerCase()
      if (!words.every(word => text.includes(word))) continue
      const section = issue.section || issue.status || ''
      if (!groups.has(section)) groups.set(section, [])
      groups.get(section)!.push(issue)
    }
    if (state.busy && !state.issues.length) rows.replaceChildren(skeleton('tasks', 5))
    else if (!groups.size) {
      rows.replaceChildren(...(state.problem ? [] : [element('p', 'empty', t(words.length ? 'No issues match this filter.' : 'No issues found.'))]))
    } else {
      rows.replaceChildren(...Array.from(groups, ([section, issues]) => {
        const expanded = !!words.length || !state.collapsedSections.has(section)
        const caption = [icon(expanded ? 'down' : 'right'), statusSwatch(issues[0]), element('span', '', section || t('No section')), element('span', 'section-count', String(issues.length))]
        const toggle = button('section-toggle', () => model.toggleSection(section), ...caption)
        toggle.dataset.focus = `section-${section}`
        toggle.setAttribute('aria-expanded', String(expanded))
        const heading = element('h2', 'section-title', words.length ? element('span', 'section-toggle', ...caption) : toggle)
        const list = element('ul', 'task-list', ...(expanded ? issues.map(issue => element('li', '', taskRow(issue))) : []))
        return element('section', 'task-section', heading, list)
      }))
    }
  }
}

function projectPicker() {
  const back = iconButton('back', t('Back to issues'), () => model.back())
  const search = searchField(t('Search projects'), model.searchProjects, value => model.searchProjects(value, true))
  const projects = element('div', 'project-results')
  main.append(element('section', 'widget', element('div', 'widget-title', back, element('h1', '', t('Choose MantisBT project'))), element('div', 'filters', search.form), projects))
  return () => {
    back.hidden = !state.project
    if (search.input.value !== state.projectQuery) search.input.value = state.projectQuery
    if (state.busy && !state.projects.length) projects.replaceChildren(skeleton('projects'))
    else if (!state.projects.length) {
      projects.replaceChildren(...(state.problem ? [] : [element('p', 'empty', t('No matching projects.'))]))
    } else {
      projects.replaceChildren(...state.projects.map(project => {
        const name = element('span', 'project-result-name', project.name)
        if (project.workspaceName) name.append(element('small', '', project.workspaceName))
        const node = button('project-result', () => model.bindProject(project), element('span', 'project-mark', icon('folder')), name, icon('right'))
        node.dataset.focus = `project-${project.id}`
        node.disabled = state.busy
        if (project.id === state.project?.id) node.setAttribute('aria-current', 'true')
        return node
      }))
    }
  }
}

function details(entry: IssueDetail) {
  const content = element('article', 'detail-content')
  const title = element('h1', 'task-title', entry.title)
  title.tabIndex = -1
  const header = element('div', 'issue-heading', element('span', 'issue-id', issueNumber(entry.id)), title)
  const meta = element('dl', 'metadata')
  const field = (name: string, ...value: (Node | string)[]) => meta.append(element('dt', '', name), element('dd', '', ...value))
  field(t('Status'), statusSwatch(entry), entry.section || entry.status || '—')
  field(t('Project'), entry.projectName || state.project?.name || '—')
  field(t('Assignee'), entry.assignee || t('Unassigned'))
  field(t('Due date'), element('span', `tone-${dueTone(entry.due || '')}`, entry.due ? formatDate(entry.due) : '—'))
  if (entry.priority) field(t('Priority'), element('span', `tone-${priorityTone(entry.priorityId)}`, entry.priority))
  for (const [label, value] of [
    ['Severity', entry.severity], ['Category', entry.category], ['Resolution', entry.resolution],
    ['Reproducibility', entry.reproducibility], ['Reporter', entry.reporter], ['Visibility', entry.viewStatus],
    ['Created', entry.createdAt && formatDate(entry.createdAt)], ['Updated', entry.updatedAt && formatDate(entry.updatedAt)],
    ['Attachments', entry.attachmentCount ? String(entry.attachmentCount) : ''], ['Tags', entry.tags?.join(', ')],
  ] as const) {
    if (value) field(t(label), value)
  }
  for (const { name, type, color, displayValue } of entry.customFields || []) {
    const value = displayValue || '—'
    field(name, ['enum', 'multi_enum'].includes(type) && displayValue ? element('span', `tone-${fieldTone(color, displayValue)}`, value) : value)
  }
  content.append(header, meta, element('section', 'description', element('h2', '', t('Description')),
    element('p', entry.description ? 'body-copy' : 'muted', entry.description || t('No description.'))))
  const related = element('section', 'widget related', element('h2', 'widget-title', t('Relationships')))
  if (entry.parent) {
    const { id, title } = entry.parent
    const parent = button('parent-task', () => model.openTask(id), icon('back'), element('span', 'issue-id', issueNumber(id)), title)
    parent.disabled = state.busy
    related.append(parent)
  }
  if (entry.subtasks) {
    const list = element('ul', 'task-list', ...state.children.map(task => element('li', '', taskRow(task))))
    const children = state.children.length ? list : state.busy ? skeleton('tasks', 2) : element('p', 'muted', state.problem ? '' : t('No open subtasks.'))
    related.append(children)
  }
  const comments = element('section', 'widget comments', element('h2', 'widget-title', t('Activities')))
  if (entry.commentsError) comments.append(element('p', 'muted', t(entry.commentsError)))
  else if (!entry.comments.length) comments.append(element('p', 'muted', t('No comments.')))
  for (const comment of entry.comments) {
    const author = element('div', 'comment-author', element('strong', '', icon('person'), comment.author))
    if (comment.at) author.append(element('time', 'muted', formatDate(comment.at)))
    comments.append(element('div', 'comment', author, element('p', 'body-copy', comment.text)))
  }
  if (entry.truncated) comments.append(element('p', 'muted', t('Preview shortened. Open original for the full content.')))
  return [content, ...(entry.parent || entry.subtasks ? [related] : []), comments]
}

function taskDetail() {
  const back = iconButton('back', t('Back'), () => model.back())
  const close = iconButton('close', t('Back to issues'), () => model.back(true))
  const external = iconButton('external', t('Open original'), () => {
    if (state.detail?.url) void frame.host.call('shell.openExternal', { url: state.detail.url }).catch(console.warn)
  })
  const body = element('div', 'detail-body')
  main.append(element('div', 'widget-title detail-toolbar', back, element('h2', '', t('View Issue Details')), element('div', 'actions', external, close)), body)
  return () => {
    back.hidden = !state.history.length
    external.hidden = !state.detail?.url
    if (state.detail) body.replaceChildren(...details(state.detail))
    else body.replaceChildren(...(state.busy ? [skeleton('detail', 5)] : []))
  }
}

function connectionSettings() {
  const server = element('input', 'token-input')
  server.type = 'text'
  server.inputMode = 'url'
  server.id = 'mantis-server'
  server.placeholder = 'https://mantis.example.com'
  server.autocomplete = 'off'
  server.addEventListener('input', () => model.editServer(server.value))
  const serverLabel = element('label', '', t('Server URL'))
  serverLabel.htmlFor = server.id
  const warning = element('p', 'warning', t('HTTP sends your token unencrypted. Use HTTPS when available.'))
  const input = element('input', 'token-input')
  input.type = 'password'
  input.id = 'mantis-token'
  input.maxLength = 8192
  input.autocomplete = 'off'
  input.addEventListener('input', () => model.editToken(input.value))
  const label = element('label', '', t('API token'))
  label.htmlFor = input.id
  const status = element('p', 'muted')
  status.setAttribute('role', 'status')
  const disconnect = button('disconnect', () => model.disconnect(), t('Disconnect'))
  const form = element('form', 'connection', serverLabel, server, warning, label, input, status, disconnect)
  form.addEventListener('submit', event => { event.preventDefault(); void model.saveToken() })
  main.append(element('section', 'widget', element('h1', 'widget-title', t('Connection settings')), form))
  return () => {
    input.placeholder = t(state.config?.configured ? 'Replace saved token' : 'Paste your token')
    if (input.value !== state.token) input.value = state.token
    if (server.value !== state.server) server.value = state.server
    server.readOnly = input.readOnly = state.busy
    warning.hidden = !/^http:\/\//i.test(state.server.trim())
    status.textContent = t(state.busy ? 'Saving…' : state.status || 'Changes save automatically.')
    disconnect.hidden = !state.config?.configured
    disconnect.disabled = state.busy
  }
}

const screens = { tasks: taskTable, projects: projectPicker, detail: taskDetail, settings: connectionSettings }
let screen: keyof typeof screens | 'loading' | undefined
let updating = false
let update = () => {}
let detailTitle = ''
let listTask = ''
let listScroll = 0
function scheduleRender() {
  if (updating) return
  updating = true
  queueMicrotask(() => {
    updating = false
    render()
  })
}

function render() {
  const next = state.settings ? 'settings' : state.detailId ? 'detail' : !state.config ? 'loading' : state.picker ? 'projects' : 'tasks'
  refresh.hidden = !state.config?.configured || state.settings
  refresh.disabled = state.busy
  settings.disabled = state.busy || (state.settings && !state.config?.configured)
  settings.setAttribute('aria-pressed', String(state.settings))
  error.hidden = !state.problem
  error.textContent = state.problem ? translateError(state.problem, locale) : ''
  const previous = screen
  const focus = (document.activeElement as HTMLElement | null)?.dataset.focus
  if (next !== screen) {
    if (screen === 'tasks') listScroll = main.scrollTop
    main.replaceChildren()
    main.dataset.screen = next
    screen = next
    update = next === 'loading' ? () => main.replaceChildren(...(state.busy ? [skeleton('tasks', 5)] : [])) : screens[next]()
  }
  update()
  if (next !== previous) {
    main.scrollTop = next === 'tasks' ? listScroll : 0
    if (next === 'tasks' && listTask) {
      main.querySelector<HTMLElement>(`[data-focus="task-${CSS.escape(listTask)}"]`)?.focus({ preventScroll: true })
    } else if (next === 'projects' && previous === 'tasks') {
      main.querySelector<HTMLInputElement>('input')?.focus()
    }
  } else if (focus) {
    main.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true })
  }
  if (next !== 'detail') detailTitle = ''
  if (next === 'detail' && state.detail && state.detail.id !== detailTitle) {
    if (previous === 'detail') main.scrollTop = 0
    detailTitle = state.detail.id
    main.querySelector<HTMLElement>('.task-title')?.focus({ preventScroll: true })
  }
}

const workspace = frame.on('workspace.changed', ({ context }) => model.onWorkspace(context?.workspaceId || null))
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && (screen === 'detail' || (screen === 'projects' && state.project))) {
    event.preventDefault()
    model.back()
  }
})
window.addEventListener('pagehide', () => { workspace.dispose(); model.dispose() }, { once: true })
void model.reload()
