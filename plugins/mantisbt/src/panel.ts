import type {} from 'orca/frame'
import type { FieldLayout, FieldSurface, Issue, IssueDetail } from './protocol'
import { fieldOptions } from './fields'
import { localeOf, translate, translateError } from './i18n'
import { statusColor, issueNumber, priorityTone, fieldTone, dueTone, dateLabel } from './presentation'
import { createPanelState, filterFields, filterValue, type FilterKey } from './panel-state'

const icons = {
  refresh: 'M16 7a6 6 0 1 0 .5 5M16 3v4h-4',
  settings: 'M3 5h14M3 10h14M3 15h14M7 3v4m6 1v4m-5 1v4',
  search: 'M13.5 13.5 17 17M15 8.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  folder: 'M2 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z',
  down: 'm5 8 5 5 5-5',
  right: 'm8 5 5 5-5 5',
  up: 'm5 12 5-5 5 5',
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
const t = (key: string, values?: Record<string, string | number>) => translate(key, locale, values)
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

function openOriginal(url: string) {
  void frame.host.call('shell.openExternal', { url }).catch(console.warn)
}

function issueId(issue: Issue) {
  const number = issueNumber(issue.id)
  if (!issue.url) return element('span', 'issue-id', number)
  const link = element('a', 'issue-id issue-link', number)
  link.href = issue.url
  link.title = t('Open original issue {id}', { id: number })
  link.setAttribute('aria-label', link.title)
  link.addEventListener('click', event => {
    event.preventDefault()
    openOriginal(issue.url)
  })
  return link
}

function fieldContent(issue: Issue, id: string, surface: FieldSurface): (Node | string)[] {
  switch (id) {
    case 'id': return [element('span', 'issue-id', issueNumber(issue.id))]
    case 'status': return [statusSwatch(issue), issue.section || issue.status || '—']
    case 'projectName': return [issue.projectName || state.project?.name || '—']
    case 'assignee': return [issue.assignee || t('Unassigned')]
    case 'priority': return issue.priority ? [element('span', `tone-${priorityTone(issue.priorityId)}`, issue.priority)] : []
    case 'due': return issue.due ? [element('span', `tone-${dueTone(issue.due)}`, surface === 'list' ? `${t('Due date')} · ${formatDate(issue.due)}` : formatDate(issue.due))] : surface === 'detail' ? ['—'] : []
    case 'createdAt': return issue.createdAt ? [formatDate(issue.createdAt)] : []
    case 'updatedAt': return issue.updatedAt ? [formatDate(issue.updatedAt)] : []
    case 'tags': return issue.tags?.length ? [issue.tags.join(', ')] : []
    case 'noteCount': return issue.noteCount ? [t('{count} notes', { count: issue.noteCount })] : []
    case 'subtasks': {
      if (!issue.subtasks) return []
      const label = t(issue.subtasks === 1 ? '{count} subtask' : '{count} subtasks', { count: issue.subtasks })
      const count = element('span', 'subtask-count', icon('subtasks'), String(issue.subtasks))
      count.title = label
      count.setAttribute('aria-label', label)
      return [count]
    }
  }
  if (id.startsWith('custom:')) {
    const field = issue.customFields?.find(field => field.id === id.slice(7))
    if (!field) return []
    const { displayValue, type, color } = field
    return ['enum', 'multi_enum'].includes(type) && displayValue
      ? [element('span', `tone-${fieldTone(color, displayValue)}`, displayValue)] : [displayValue || '—']
  }
  const value = issue[id as keyof Issue]
  return (typeof value === 'string' || typeof value === 'number') && value ? [String(value)] : []
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
  const metadata = element('span', 'row-meta')
  const layout = state.fieldLayout.list
  for (const field of fieldOptions('list', issue.customFields ?? [], layout)) {
    if (!field.visible || (!layout && ['id', 'status'].includes(field.id))) continue
    const content = fieldContent(issue, field.id, 'list')
    if (content.length) {
      const cell = element('span', 'row-field', ...content)
      if (layout) cell.prepend(element('span', 'row-field-name', field.id.startsWith('custom:') ? field.name : t(field.name)))
      metadata.append(cell)
    }
  }
  if (layout) {
    row.classList.add('task-row--custom')
    row.append(summary)
  } else {
    row.append(...fieldContent(issue, 'id', 'list'), summary, element('span', 'row-status', ...fieldContent(issue, 'status', 'list')))
  }
  if (metadata.childElementCount) row.append(metadata)
  return row
}

const filterKeys: FilterKey[] = ['status', 'assignee', 'priority', 'severity', 'category', 'reporter']

function issueFilters() {
  let active: FilterKey = 'status'
  let values: string[] = []
  let selected: string[] = []
  const statuses = new Map<string, Issue>()
  const options = element('div', 'filter-values')
  options.id = 'mantis-filter-options'
  options.setAttribute('role', 'group')
  const search = searchField(t('Find an option'), () => {
    options.scrollTop = 0
    renderOptions()
  })
  const reset = button('view-button', model.clearFilters, t('Reset filters'))
  reset.dataset.focus = 'reset-filters'
  const chips = element('div', 'filter-chips')
  const selection = element('div', 'filter-selection', chips, reset)
  const tally = element('p', 'filter-footer muted')
  tally.setAttribute('role', 'status')
  const tabs = filterKeys.map(key => {
    const tab = button('filter-tab', () => {
      if (active === key) return
      active = key
      search.input.value = ''
      options.scrollTop = 0
      scheduleRender()
    })
    tab.setAttribute('aria-controls', options.id)
    return { key, tab }
  })
  const categories = element('div', 'filter-categories', ...tabs.map(({ tab }) => tab))
  categories.setAttribute('role', 'group')
  categories.setAttribute('aria-label', t('Filter fields'))
  const body = element('div', 'filter-controls', categories, search.form, options, tally)
  body.id = 'mantis-filter-panel'

  function valueLabel(key: FilterKey, value: string) {
    const label = element('span', 'filter-value', value || t('None'))
    const issue = key === 'status' ? statuses.get(value) : undefined
    if (value && issue) label.prepend(statusSwatch(issue))
    return label
  }

  function renderOptions() {
    const key = active
    const query = search.input.value.trim().toLocaleLowerCase(locale)
    const scroll = options.scrollTop
    const filtered = values.filter(value => (value || t('None')).toLocaleLowerCase(locale).includes(query))
    options.replaceChildren(...filtered.map(value => {
      const input = element('input')
      input.type = 'checkbox'
      input.checked = selected.includes(value)
      input.dataset.focus = `filter-${key}-${value}`
      input.addEventListener('change', () => model.toggleFilter(key, value))
      return element('label', '', valueLabel(key, value), input)
    }))
    if (!filtered.length) options.append(element('p', 'muted', t(query ? 'No matching filter options.' : 'No values')))
    options.scrollTop = scroll
  }

  return {
    selection, body,
    update(matches: number, selectionCount: number) {
      selection.hidden = !selectionCount
      body.hidden = !state.filtersOpen
      if (selection.hidden) chips.replaceChildren()
      if (body.hidden && selection.hidden) return
      if ((!body.hidden && active === 'status') || state.filters.status?.length) {
        statuses.clear()
        for (const issue of state.issues) {
          const value = filterValue(issue, 'status')
          if (!statuses.has(value)) statuses.set(value, issue)
        }
      }
      if (!selection.hidden) chips.replaceChildren(...filterKeys.flatMap(key => (state.filters[key] ?? []).map(value => {
        const chip = button('filter-chip', () => model.toggleFilter(key, value),
          element('span', 'filter-chip-field', t(filterFields[key])), valueLabel(key, value), icon('close'))
        chip.dataset.focus = `remove-filter-${key}-${value}`
        chip.title = `${t('Remove filter')} · ${t(filterFields[key])} · ${value || t('None')}`
        chip.setAttribute('aria-label', chip.title)
        return chip
      })))
      if (body.hidden) return
      tally.textContent = t(state.next ? '{count} of {total} loaded issues' : '{count} of {total} issues', {
        count: matches, total: state.issues.length,
      })
      for (const { key, tab } of tabs) {
        const count = state.filters[key]?.length ?? 0
        tab.textContent = count ? `${t(filterFields[key])} (${count})` : t(filterFields[key])
        tab.setAttribute('aria-pressed', String(active === key))
      }
      options.setAttribute('aria-label', t(filterFields[active]))
      selected = state.filters[active] ?? []
      values = [...new Set([...state.issues.map(issue => filterValue(issue, active)), ...selected])]
        .sort((a, b) => a.localeCompare(b, locale, { numeric: true }))
      search.form.hidden = values.length <= 7 && !search.input.value
      renderOptions()
    },
  }
}

function taskTable() {
  const head = element('div', 'list-head', element('span', '', 'ID'), element('span', '', t('Summary')), element('span', '', t('Status')))
  const rows = element('div', 'task-groups')
  const filter = searchField(t('Filter issues'), model.setQuery)
  const filters = issueFilters()
  const toggleFilters = button('view-button', model.toggleFilters)
  toggleFilters.dataset.focus = 'filter-toggle'
  toggleFilters.setAttribute('aria-controls', filters.body.id)
  const fields = button('view-button', model.openFields, t('Field display'))
  fields.dataset.focus = 'open-fields'
  const projectLabel = element('span', 'project-name')
  const chooser = button('project-button', () => model.chooseProject(), element('span', 'project-mark', icon('folder')), projectLabel, icon('down'))
  chooser.title = t('Choose MantisBT project')
  const mine = button('view-button', () => model.selectTab('mine'), t('Mine'))
  const all = button('view-button', () => model.selectTab('all'), t('All'))
  const viewBar = element('nav', 'view-bar', mine, all)
  viewBar.setAttribute('aria-label', t('Issue views'))
  const more = button('more-button', () => model.more(), t('Load more'))
  const fetchAll = button('view-button', model.fetchAll, t('Fetch all issues'))
  const stop = button('view-button', model.stopFetchAll, t('Stop fetching'))
  const progress = element('span', 'muted')
  progress.setAttribute('role', 'status')
  const fetchControls = element('div', 'fetch-controls', fetchAll, stop, progress)
  const title = element('h1', 'widget-title')
  const list = element('section', 'widget issue-widget', title, fetchControls, head, rows, more)
  main.append(element('div', 'project-header', chooser), viewBar, element('div', 'filters',
    element('div', 'filter-toolbar', filter.form, toggleFilters, fields), filters.selection, filters.body), list)
  return () => {
    projectLabel.textContent = state.project?.name || t('Choose MantisBT project')
    title.textContent = t(state.tab === 'mine' ? 'Assigned to Me' : 'Viewing Issues')
    chooser.disabled = mine.disabled = all.disabled = more.disabled = state.busy
    mine.setAttribute('aria-pressed', String(state.tab === 'mine'))
    all.setAttribute('aria-pressed', String(state.tab === 'all'))
    if (filter.input.value !== state.query) filter.input.value = state.query
    fetchControls.hidden = state.tab !== 'all'
    fetchAll.hidden = state.fetchingAll
    fetchAll.disabled = state.busy || !state.next
    stop.hidden = !state.fetchingAll
    progress.textContent = state.fetchingAll ? t('Fetched {count} pages', { count: state.fetchPages })
      : !state.busy && !state.next && !state.problem ? t('All issues loaded') : ''
    const selectedFilters = filterKeys.filter(key => state.filters[key]?.length)
    const selectionCount = selectedFilters.reduce((total, key) => total + state.filters[key]!.length, 0)
    toggleFilters.textContent = selectionCount ? `${t('Filters')} (${selectionCount})` : t('Filters')
    toggleFilters.setAttribute('aria-expanded', String(state.filtersOpen))
    fields.disabled = state.busy || !state.project
    head.hidden = !!state.fieldLayout.list
    more.hidden = !state.next || state.tab !== 'all'
    const words = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    const filtered = !!(words.length || selectedFilters.length)
    const groups = new Map<string, Issue[]>()
    let matches = 0
    for (const issue of state.issues) {
      const text = [issue.id, issueNumber(issue.id), issue.title, issue.assignee, issue.section, issue.category].join(' ').toLowerCase()
      if (!words.every(word => text.includes(word)) || !selectedFilters.every(key => state.filters[key]!.includes(filterValue(issue, key)))) continue
      matches++
      const section = issue.section || issue.status || ''
      if (!groups.has(section)) groups.set(section, [])
      groups.get(section)!.push(issue)
    }
    filters.update(matches, selectionCount)
    if (state.busy && !state.issues.length) rows.replaceChildren(skeleton('tasks', 5))
    else if (!groups.size) {
      rows.replaceChildren(...(state.problem ? [] : [element('p', 'empty', t(filtered ? 'No issues match this filter.' : 'No issues found.'))]))
    } else {
      rows.replaceChildren(...Array.from(groups, ([section, issues]) => {
        const expanded = filtered || !state.collapsedSections.has(section)
        const caption = [icon(expanded ? 'down' : 'right'), statusSwatch(issues[0]), element('span', '', section || t('No section')), element('span', 'section-count', String(issues.length))]
        const toggle = button('section-toggle', () => model.toggleSection(section), ...caption)
        toggle.dataset.focus = `section-${section}`
        toggle.setAttribute('aria-expanded', String(expanded))
        const heading = element('h2', 'section-title', filtered ? element('span', 'section-toggle', ...caption) : toggle)
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
  const header = element('div', 'issue-heading', issueId(entry), title)
  const meta = element('dl', 'metadata')
  for (const field of fieldOptions('detail', entry.customFields ?? [], state.fieldLayout.detail)) {
    if (!field.visible) continue
    const value = fieldContent(entry, field.id, 'detail')
    if (value.length) meta.append(element('dt', '', field.id.startsWith('custom:') ? field.name : t(field.name)), element('dd', '', ...value))
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
  const backLabel = element('span')
  const back = button('detail-back', () => model.back(), icon('back'), backLabel)
  const list = button('detail-list', () => model.back(true), t('Issue list'))
  const external = iconButton('external', t('Open original'), () => {
    if (state.detail?.url) openOriginal(state.detail.url)
  })
  const fields = iconButton('settings', t('Field display'), model.openFields)
  fields.dataset.focus = 'open-fields'
  const body = element('div', 'detail-body')
  main.append(element('div', 'detail-toolbar', back, element('div', 'actions', list, fields, external)), body)
  return () => {
    backLabel.textContent = t(state.history.length ? 'Previous issue' : 'Back to issues')
    list.hidden = !state.history.length
    external.hidden = !state.detail?.url
    fields.disabled = state.busy || !state.project
    if (state.detail) body.replaceChildren(...details(state.detail))
    else body.replaceChildren(...(state.busy ? [skeleton('detail', 5)] : []))
  }
}

function fieldEditor() {
  let surface: FieldSurface = state.detailId ? 'detail' : 'list'
  const draft: FieldLayout = { ...state.fieldLayout }
  let dirty = false
  const rows = element('ul', 'field-rows')
  const save = button('view-button', () => model.saveFields(draft), t('Save fields'))
  const back = iconButton('back', t('Back'), model.closeFields)
  const retry = button('view-button', model.openFields, t('Retry'))
  const project = element('p', 'field-project', state.project?.name || '')
  const tabs = (['list', 'detail'] as const).map(key => {
    const tab = button('view-button', () => { surface = key; scheduleRender() }, t(key === 'list' ? 'List fields' : 'Issue details'))
    return { key, tab }
  })
  const reset = button('view-button', () => {
    delete draft[surface]
    dirty = true
    scheduleRender()
  }, t('Restore default fields'))
  main.append(element('section', 'widget',
    element('div', 'widget-title', back, element('h1', '', t('Field display'))), project,
    element('nav', 'view-bar', ...tabs.map(({ tab }) => tab)), rows,
    element('div', 'field-actions', retry, reset, save)))
  return () => {
    for (const { key, tab } of tabs) tab.setAttribute('aria-pressed', String(key === surface))
    back.disabled = state.busy
    retry.hidden = !!state.fieldCatalog || state.busy
    reset.disabled = !draft[surface] || state.busy
    save.disabled = !dirty || state.busy
    const custom = state.fieldCatalog ?? Array.from(new Map(
      [...state.issues, ...(state.detail ? [state.detail] : [])].flatMap(issue => issue.customFields ?? []).map(field => [field.id, field]),
    ).values())
    const options = fieldOptions(surface, custom, draft[surface])
    function change() {
      const known = new Set(options.map(field => field.id))
      const missing = (draft[surface] ?? []).filter(field => !known.has(field.id))
      draft[surface] = [...options.map(({ id, visible }) => ({ id, visible })), ...missing]
      dirty = true
      scheduleRender()
    }
    rows.replaceChildren(...options.map((field, index) => {
      const name = field.id.startsWith('custom:') ? field.name : t(field.name)
      const check = element('input')
      check.type = 'checkbox'
      check.checked = field.visible
      check.disabled = state.busy
      check.dataset.focus = `field-check-${field.id}`
      check.addEventListener('change', () => { field.visible = check.checked; change() })
      const move = (direction: -1 | 1) => {
        const up = direction === -1
        const button = iconButton(up ? 'up' : 'down', `${t(up ? 'Move up' : 'Move down')} · ${name}`, () => {
          const other = index + direction
          options[index] = options[other]
          options[other] = field
          change()
        })
        button.dataset.focus = `field-${direction}-${field.id}`
        button.disabled = state.busy || index + direction < 0 || index + direction >= options.length
        return button
      }
      return element('li', 'field-row', element('label', '', check, name), element('div', 'actions', move(-1), move(1)))
    }))
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

const screens = { tasks: taskTable, projects: projectPicker, detail: taskDetail, settings: connectionSettings, fields: fieldEditor }
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
  const next = state.settings ? 'settings' : state.fieldEditor ? 'fields' : state.detailId ? 'detail' : !state.config ? 'loading' : state.picker ? 'projects' : 'tasks'
  refresh.hidden = !state.config?.configured || state.settings || state.fieldEditor
  refresh.disabled = state.busy
  settings.disabled = state.busy || state.fieldEditor || (state.settings && !state.config?.configured)
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
    if (previous === 'fields' && (next === 'tasks' || next === 'detail')) {
      main.querySelector<HTMLElement>('[data-focus="open-fields"]')?.focus({ preventScroll: true })
    } else if (next === 'tasks' && listTask) {
      main.querySelector<HTMLElement>(`[data-focus="task-${CSS.escape(listTask)}"]`)?.focus({ preventScroll: true })
    } else if (next === 'projects' && previous === 'tasks') {
      main.querySelector<HTMLInputElement>('input')?.focus()
    }
  } else if (focus) {
    const target = main.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focus)}"]`)
    const filterToggle = focus.startsWith('remove-filter-') || focus === 'reset-filters'
      ? main.querySelector<HTMLElement>('[data-focus="filter-toggle"]') : null
    const focusTarget = target?.closest('[hidden]') ? filterToggle : target ?? filterToggle
    focusTarget?.focus({ preventScroll: true })
  }
  if (next !== 'detail') detailTitle = ''
  if (next === 'detail' && state.detail && state.detail.id !== detailTitle) {
    if (previous === 'detail') main.scrollTop = 0
    detailTitle = state.detail.id
    if (previous !== 'fields') main.querySelector<HTMLElement>('.task-title')?.focus({ preventScroll: true })
  }
}

const workspace = frame.on('workspace.changed', ({ context }) => model.onWorkspace(context?.workspaceId || null))
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  if (screen === 'tasks' && state.filtersOpen && event.target instanceof HTMLElement && event.target.closest('.filters')) {
    if (event.target instanceof HTMLInputElement && event.target.type === 'search' && event.target.value) return
    event.preventDefault()
    model.toggleFilters()
    main.querySelector<HTMLElement>('[data-focus="filter-toggle"]')?.focus({ preventScroll: true })
  } else if (screen === 'fields' && !state.busy) {
    event.preventDefault()
    model.closeFields()
  } else if (screen === 'detail' || (screen === 'projects' && state.project)) {
    event.preventDefault()
    model.back()
  }
})
window.addEventListener('pagehide', () => { workspace.dispose(); model.dispose() }, { once: true })
void model.reload()
