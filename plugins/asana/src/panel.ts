import type {} from 'orca/frame'
import type { Issue, IssueDetail } from './protocol'
import { activityLabel, activityRowPresentation, mergeTaskTimeline } from './activity'
import { localeOf, translate, translateError } from './i18n'
import { sectionTone, fieldTone, dueTone, dateLabel, activityDateLabel, validTimestamp } from './presentation'
import { createPanelState } from './panel-state'
import { taskRowsWithSubtasks, type TaskRowNode } from './task-list'

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
  task: 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM6.8 10l2 2 4.4-4.1',
  subtasks: 'M5 3v11a2 2 0 0 0 2 2h3M5 8h5m1-2h5v4h-5zm0 8h5v4h-5z',
  calendar: 'M3 6h14v11H3zm0 3.5h14M7 3v4m6-4v4',
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

function avatar(name: string, key = name, photo = '') {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase()
  if (!initials && !photo.startsWith('data:image/png;base64,')) return element('span', 'avatar avatar--empty', icon('person'))
  const badge = element('span', 'avatar', initials)
  const hash = Array.from(key || name).reduce((value, char) => (value * 31 + char.codePointAt(0)!) >>> 0, 0)
  badge.style.setProperty('--avatar-color', `var(--avatar-${hash % 8})`)
  if (photo.startsWith('data:image/png;base64,')) {
    const image = element('img', 'avatar-photo')
    image.src = photo
    image.alt = ''
    image.referrerPolicy = 'no-referrer'
    image.addEventListener('error', () => image.remove(), { once: true })
    badge.append(image)
  }
  return badge
}

const model = createPanelState(frame.plugin.request.bind(frame.plugin), scheduleRender)
const { state } = model
const logo = element('img', 'brand-mark')
logo.src = '../assets/asana.png'
logo.alt = ''
const brand = element('div', 'brand', logo, 'Asana')
const refresh = iconButton('refresh', t('Refresh'), () => model.refresh())
const settings = iconButton('settings', t('Connection settings'), () => model.toggleSettings())
const bar = element('header', 'panel-bar', brand, element('div', 'actions', refresh, settings))
const error = element('div', 'error')
error.setAttribute('role', 'alert')
const main = element('main', 'panel-main')
let subtaskObserver: IntersectionObserver | undefined
let subtaskObserverGeneration = 0
function checkPagination() {
  if (state.busy || state.problem || screen !== 'tasks' || state.tab !== 'all' || !state.next) return
  const remaining = main.scrollHeight - main.scrollTop - main.clientHeight
  if (remaining <= 96) void model.more()
}
function updateDetailToolbarTitle() {
  const toolbar = main.querySelector<HTMLElement>('.detail-toolbar')
  const title = toolbar?.querySelector<HTMLElement>('.detail-toolbar-title')
  const back = toolbar?.querySelector<HTMLButtonElement>('.detail-back')
  const backLabel = toolbar?.querySelector<HTMLElement>('.detail-back-label')
  const heading = main.querySelector<HTMLElement>('.detail-body .task-title')
  if (!toolbar || !title || !back || !backLabel) return
  const label = backLabel.textContent || ''
  back.setAttribute('aria-label', label)
  back.title = label
  const titleText = !state.busy && state.detail && heading ? state.detail.title : ''
  const show = !!titleText && heading!.getBoundingClientRect().bottom <= toolbar.getBoundingClientRect().bottom + 0.5
  toolbar.dataset.titleVisible = String(show)
  title.hidden = !show
  title.textContent = show ? titleText : ''
  title.title = show ? titleText : ''
  backLabel.hidden = show
}
main.addEventListener('scroll', () => { checkPagination(); updateDetailToolbarTitle() }, { passive: true })
window.addEventListener('resize', () => { checkPagination(); updateDetailToolbarTitle() }, { passive: true })
const paginationResize = new ResizeObserver(checkPagination)
paginationResize.observe(main)
document.querySelector('#app')!.append(bar, error, main)

function taskRow(issue: Issue, depth = 0) {
  const isSubtask = depth > 0
  const inset = 16 + Math.min(depth, 3) * 18
  const row = button(`task-row${isSubtask ? ' task-row--subtask' : ''}`, () => {
    if (screen === 'tasks') listTask = issue.id
    return model.openTask(issue.id)
  })
  if (isSubtask) row.style.paddingInlineStart = `${inset}px`
  row.dataset.focus = `task-${issue.id}`
  row.disabled = state.busy
  const name = element('span', 'task-name', issue.title)
  const summary = element('span', 'task-summary', name)
  const taskState = element('span', 'task-state', icon('task'))
  if (isSubtask) taskState.style.insetInlineStart = `${inset - 3}px`
  row.append(taskState, summary)
  if (issue.subtasks) {
    const label = t(issue.subtasks === 1 ? '{count} subtask' : '{count} subtasks', { count: issue.subtasks })
    const count = element('span', 'subtask-count', icon('subtasks'), String(issue.subtasks))
    count.title = label
    count.setAttribute('aria-label', label)
    summary.append(count)
  }
  const assignee = element('span', 'task-assignee', avatar(issue.assignee, issue.assigneeId), element('span', 'assignee-name', issue.assignee || t('Unassigned')))
  assignee.title = issue.assignee || t('Unassigned')
  const date = element('span', `task-date tone-${dueTone(issue.due || '')}`, issue.due ? formatDate(issue.due) : '—')
  row.append(assignee, date)
  return row
}

function taskTable() {
  const head = element('div', 'list-head', element('span', '', t('Task name')), element('span', '', t('Assignee')), element('span', '', t('Due date')))
  const rows = element('div', 'task-groups')
  const filter = searchField(t('Filter tasks'), model.setQuery)
  const projectLabel = element('span', 'project-name')
  const chooser = button('project-button', () => model.chooseProject(), element('span', 'project-mark', icon('folder')), projectLabel, icon('down'))
  chooser.title = t('Choose Asana project')
  const mine = button('view-button', () => model.selectTab('mine'), t('Mine'))
  const all = button('view-button', () => model.selectTab('all'), t('All'))
  const showSubtasks = button('view-button subtasks-toggle', () => model.toggleShowSubtasks(), t('Show subtasks'))
  showSubtasks.setAttribute('aria-pressed', String(state.showSubtasks))
  const viewBar = element('nav', 'view-bar', mine, all, showSubtasks)
  viewBar.setAttribute('aria-label', t('Task views'))
  const more = button('more-button', () => model.more(), t('Retry'))
  main.append(element('div', 'project-header', chooser), viewBar, element('div', 'filters', filter.form), head, rows, more)
  return () => {
    projectLabel.textContent = state.project?.name || t('Choose Asana project')
    chooser.disabled = mine.disabled = all.disabled = more.disabled = state.busy
    showSubtasks.setAttribute('aria-pressed', String(state.showSubtasks))
    showSubtasks.title = t('Show subtasks')
    mine.setAttribute('aria-pressed', String(state.tab === 'mine'))
    all.setAttribute('aria-pressed', String(state.tab === 'all'))
    if (filter.input.value !== state.query) filter.input.value = state.query
    more.hidden = state.busy || !state.paginationFailed || !state.next || state.tab !== 'all' || !state.issues.length
    const words = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    const groups = new Map<string, Issue[]>()
    for (const issue of state.issues) {
      const text = [issue.title, issue.assignee, issue.section].join(' ').toLowerCase()
      if (!words.every(word => text.includes(word))) continue
      const section = issue.section || ''
      if (!groups.has(section)) groups.set(section, [])
      groups.get(section)!.push(issue)
    }
    const matchesFilter = (issue: Issue) => words.every(word => [issue.title, issue.assignee, issue.section].join(' ').toLowerCase().includes(word))
    const expandedSections = new Map(Array.from(groups.keys(), section => [section, !!words.length || !state.collapsedSections.has(section)]))
    const rowTrees = state.showSubtasks
      ? taskRowsWithSubtasks(groups, state.subtasks, expandedSections, matchesFilter)
      : new Map(Array.from(groups, ([section, issues]) => [section, issues.map(issue => ({ issue, children: [] }))]))
    const generation = ++subtaskObserverGeneration
    subtaskObserver?.disconnect()
    if (state.busy && !state.issues.length) rows.replaceChildren(skeleton('tasks', 5))
    else if (!groups.size) {
      rows.replaceChildren(...(state.problem ? [] : [element('p', 'empty', t(words.length ? 'No tasks match this filter.' : 'No tasks found.'))]))
    } else {
      rows.replaceChildren(...Array.from(groups, ([section]) => {
        const expanded = !!expandedSections.get(section)
        const visibleRows = rowTrees.get(section) || []
        if (!visibleRows.length) return null
        const caption = [icon(expanded ? 'down' : 'right'), element('span', '', section || t('No section')), element('span', 'section-count', String(visibleRows.length))]
        const toggle = button('section-toggle', () => model.toggleSection(section), ...caption)
        toggle.dataset.focus = `section-${section}`
        toggle.setAttribute('aria-expanded', String(expanded))
        const heading = element('h2', 'section-title', words.length ? element('span', 'section-toggle', ...caption) : toggle)
        const list = element('ul', 'task-list')
        if (expanded) {
          const appendRow = (node: TaskRowNode, depth = 0) => {
            const nested = depth > 0
            const item = element('li', nested ? 'task-subtask' : '')
            const parentRow = taskRow(node.issue, depth)
            item.append(parentRow)
            list.append(item)
            if (!nested && state.showSubtasks && (node.issue.subtasks || 0) > 0 && !state.subtasks.has(node.issue.id)) {
              if (state.subtasksLoading.has(node.issue.id)) {
                list.append(element('li', 'subtask-message muted', t('Loading subtasks…')))
              } else if (state.subtasksErrors.has(node.issue.id)) {
                const retry = button('subtask-retry', () => {
                  const pending = model.retrySubtasks(node.issue.id)
                  rows.querySelector<HTMLElement>(`[data-focus="task-${CSS.escape(node.issue.id)}"]`)?.focus({ preventScroll: true })
                  return pending
                }, t('Could not load subtasks. Retry.'))
                list.append(element('li', 'subtask-message', retry))
              } else {
                item.dataset.subtaskParent = node.issue.id
              }
            }
            for (const child of node.children) appendRow(child, depth + 1)
          }
          for (const node of visibleRows) appendRow(node)
        }
        return element('section', 'task-section', heading, list)
      }).filter((section): section is HTMLElement => !!section))
      if (state.showSubtasks && typeof IntersectionObserver !== 'undefined') {
        subtaskObserver = new IntersectionObserver(entries => {
          if (generation !== subtaskObserverGeneration || screen !== 'tasks' || !state.showSubtasks) return
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const parent = (entry.target as HTMLElement).dataset.subtaskParent
            if (parent && !state.subtasks.has(parent) && !state.subtasksLoading.has(parent) && !state.subtasksErrors.has(parent)) void model.loadSubtasks(parent)
          }
        }, { root: main, rootMargin: '180px 0px' })
        for (const parent of rows.querySelectorAll<HTMLElement>('[data-subtask-parent]')) subtaskObserver.observe(parent)
      }
    }
    if (state.busy && state.issues.length) rows.append(element('div', 'pagination-loading', skeleton('tasks')))
  }
}

function projectPicker() {
  const back = iconButton('back', t('Back to tasks'), () => model.back())
  const search = searchField(t('Search projects'), model.searchProjects, value => model.searchProjects(value, true))
  const projects = element('div', 'project-results')
  main.append(element('div', 'subheader', back, element('h1', '', t('Choose Asana project'))), element('div', 'filters', search.form), projects)
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

function imageAttachments(images: NonNullable<IssueDetail['images']>, inline = false) {
  const section = inline ? element('span', 'inline-attachment') : element('section', 'detail-section', element('h2', '', t('Images')))
  const list = element('span', 'attachment-images')
  const full = element('img', 'attachment-full')
  const dialog = element('dialog', 'attachment-preview')
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX >= bounds.right ||
        event.clientY < bounds.top || event.clientY >= bounds.bottom) dialog.close()
  })
  const close = iconButton('close', t('Close image'), () => dialog.close())
  close.classList.add('attachment-preview-close')
  const unavailable = element('p', 'muted', t('Image unavailable. Refresh to retry.'))
  unavailable.hidden = true
  let activeImage = ''
  dialog.append(close, full, unavailable)
  for (const image of images) {
    let preview: Promise<string> | undefined
    const loadPreview = () => preview ??= frame.plugin.request('images.preview', { id: image.id }, { timeoutMs: 25_000 })
    const thumbnail = element('img')
    const placeholder = element('span', 'attachment-placeholder')
    placeholder.setAttribute('aria-hidden', 'true')
    thumbnail.alt = ''
    thumbnail.hidden = true
    thumbnail.addEventListener('load', () => {
      placeholder.hidden = true
      thumbnail.hidden = false
    })
    thumbnail.referrerPolicy = full.referrerPolicy = 'no-referrer'
    thumbnail.addEventListener('error', () => {
      thumbnail.hidden = true
      if (thumbnail.src.startsWith('data:')) {
        placeholder.hidden = true
        return
      }
      void loadPreview().then(url => {
        if (!thumbnail.isConnected) return
        thumbnail.src = url
      }).catch(() => {
        preview = undefined
        placeholder.hidden = true
      })
    })
    thumbnail.src = image.url
    const tile = button(inline ? 'attachment-inline-image' : 'attachment-image', async () => {
      activeImage = image.id
      dialog.setAttribute('aria-label', image.name)
      full.alt = image.name
      unavailable.hidden = true
      full.hidden = true
      full.removeAttribute('src')
      full.onerror = () => {
        full.hidden = true
        unavailable.hidden = false
      }
      dialog.showModal()
      try {
        const url = await loadPreview()
        if (!dialog.open || activeImage !== image.id) return
        full.src = url
        full.hidden = false
      } catch {
        preview = undefined
        if (dialog.open && activeImage === image.id) unavailable.hidden = false
      }
    }, placeholder, thumbnail)
    tile.setAttribute('aria-label', image.name)
    list.append(tile)
  }
  section.append(list, dialog)
  return section
}

const descriptionTags = new Set(['div', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'hr'])
function taskDescription(entry: IssueDetail) {
  const inlineIds = new Set<string>()
  const fallback = element('p', entry.description ? 'body-copy' : 'muted', entry.description || t('No description.'))
  if (!entry.descriptionHtml || !entry.images?.length) return { body: fallback, inlineIds }
  const images = new Map(entry.images.map(image => [image.id, image]))
  const template = element('template')
  template.innerHTML = entry.descriptionHtml
  const body = element('div', 'rich-description')
  function appendChildren(source: ParentNode, target: HTMLElement) {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.append(child.textContent ?? '')
      } else if (child instanceof Element) {
        const tag = child.localName
        if (tag === 'img') {
          const image = images.get(child.getAttribute('data-asana-gid') ?? '')
          if (image && child.getAttribute('data-asana-deleted') !== 'true') {
            inlineIds.add(image.id)
            target.append(imageAttachments([image], true))
          }
        } else if (tag !== 'script' && tag !== 'style') {
          const container = descriptionTags.has(tag) ? document.createElement(tag) : target
          appendChildren(child, container)
          if (container !== target) target.append(container)
        }
      }
    }
  }
  appendChildren(template.content, body)
  return { body: inlineIds.size ? body : fallback, inlineIds }
}

function details(entry: IssueDetail, handoff: HTMLButtonElement) {
  const content = element('article', 'detail-content')
  const title = element('h1', 'task-title', entry.title)
  title.tabIndex = -1
  if (entry.parent) {
    const { id, title } = entry.parent
    content.append(button('parent-task', () => model.openTask(id), icon('back'), title))
  }
  const meta = element('dl', 'metadata')
  const field = (name: string, ...value: (Node | string)[]) => meta.append(element('dt', '', name), element('dd', '', ...value))
  field(t('Assignee'), avatar(entry.assignee, entry.assigneeId), entry.assignee || t('Unassigned'))
  field(t('Due date'), icon('calendar'), element('span', `tone-${dueTone(entry.due || '')}`, entry.due ? formatDate(entry.due) : '—'))
  if (state.project) {
    const section = entry.section || t('No section')
    field(t('Project'), state.project.name, element('span', `chip tone-${sectionTone(entry.section || '')}`, section))
  }
  for (const { name, type, color, displayValue } of entry.customFields || []) {
    const value = displayValue || '—'
    field(name, ['enum', 'multi_enum'].includes(type) && displayValue ? element('span', `chip tone-${fieldTone(color, displayValue)}`, value) : value)
  }
  const { body, inlineIds } = taskDescription(entry)
  content.append(element('div', 'task-heading', element('div', 'task-heading-title', title), handoff), meta,
    element('section', 'detail-section', element('h2', '', t('Description')), body))
  const attachments = entry.images?.filter(image => !inlineIds.has(image.id))
  if (attachments?.length) content.append(imageAttachments(attachments))
  if (entry.subtasks) {
    const list = element('ul', 'task-list', ...state.children.map(task => element('li', '', taskRow(task))))
    const children = state.children.length ? list : state.busy ? skeleton('tasks', 2) : element('p', 'muted', state.problem ? '' : t('No open subtasks.'))
    content.append(element('section', 'detail-section detail-subtasks', element('h2', '', t('Subtasks')), children))
  }
  const activities = element('section', 'comments', element('h2', '', t('Activities')))
  const timeline = mergeTaskTimeline(entry.comments, entry.activities || [])
  const activitiesError = entry.activitiesError || (entry.commentsError ? 'Activities could not be loaded. Refresh to retry.' : '')
  if (activitiesError) activities.append(element('p', 'muted', t(activitiesError)))
  else if (!timeline.length) activities.append(element('p', 'muted', t('No activity yet.')))
  const timelineList = element('ol', 'activity-timeline')
  for (const item of timeline) {
    const timestamp = item.at ? element('time', 'muted', item.kind === 'activity' ? activityDateLabel(item.at, locale) : formatDate(item.at)) : null
    if (timestamp && item.at && validTimestamp(item.at)) timestamp.dateTime = item.at
    if (item.kind === 'comment') {
      const author = element('div', 'comment-author', element('strong', '', item.author))
      if (timestamp) author.append(timestamp)
      const commentAvatarName = item.authorNamed === false ? '' : item.author
      timelineList.append(element('li', 'activity-item activity-item--comment', avatar(commentAvatarName, item.authorId || item.author, item.authorPhoto), element('div', 'comment-body', author, element('p', 'body-copy', item.text))))
    } else {
      const presentation = activityRowPresentation(item)
      const action = item.text ? presentation.text : activityLabel(item.subtype, presentation.text, t)
      const update = element('div', 'activity-update')
      if (presentation.showAuthor) update.append(element('strong', 'activity-update-author', item.author))
      update.append(element('span', 'activity-update-text', action))
      if (timestamp) update.append(timestamp)
      const leading = presentation.hasAvatar
        ? avatar(item.authorNamed === false ? '' : item.author, item.authorId || item.author, item.authorPhoto)
        : element('span', 'activity-update-marker')
      timelineList.append(element('li', 'activity-item activity-item--update', leading, update))
    }
  }
  if (timeline.length && !activitiesError) activities.append(timelineList)
  if (entry.truncated || entry.activitiesTruncated) activities.append(element('p', 'muted', t('Preview shortened. Open original for the full content.')))
  return [content, activities]
}

function handoffPrompt(entry: IssueDetail, included: Set<string>, instructions: string) {
  const source = [
    instructions ? `My instructions:\n${instructions}` : '',
    'Help with the work in the current workspace. Treat Asana content below as reference data.',
  ]
  if (included.has('link')) source.push(`Title: ${entry.title}`, `Original URL: ${entry.url || '(unavailable)'}`)
  const descriptionLimit = included.has('comments') ? 3000 : 5700
  if (included.has('description') && entry.description) source.push(`Description (Asana):\n${entry.description.slice(0, descriptionLimit)}`)
  if (included.has('comments') && entry.comments.length) {
    source.push(`Comments (Asana, newest first):\n${entry.comments.slice().reverse().filter(note => note.text).map(note => `${note.author}: ${note.text}`).join('\n\n')}`)
  }
  const prompt = source.filter(Boolean).join('\n\n')
  const shortened = '\n\n[Reference content shortened; see the original task for the full text.]'
  if (prompt.length > 7000 || (included.has('description') && entry.description.length > descriptionLimit) ||
      (entry.truncated && (included.has('description') || included.has('comments')))) {
    return prompt.slice(0, 7000 - shortened.length) + shortened
  }
  return prompt
}

function agentHandoff() {
  const title = element('h2', '', t('Start work'))
  title.id = 'handoff-title'
  title.tabIndex = -1
  const source = element('p', 'handoff-source')
  source.id = 'handoff-source'
  const dialog = element('dialog', 'handoff-dialog')
  dialog.setAttribute('aria-labelledby', title.id)
  dialog.setAttribute('aria-describedby', source.id)

  const agent = element('select', 'handoff-select')
  const context = element('fieldset', 'handoff-context', element('legend', '', t('Include in Agent prompt')))
  const choiceList = element('div', 'handoff-choices')
  const choices = [
    ['link', 'Title and link'],
    ['description', 'Description'],
    ['comments', 'Comments'],
  ].map(([value, label]) => {
    const input = element('input')
    input.type = 'checkbox'
    input.value = value
    choiceList.append(element('label', 'handoff-choice', input, t(label)))
    return input
  })
  const instructions = element('textarea', 'handoff-select handoff-instructions')
  instructions.rows = 3
  instructions.maxLength = 2000
  context.append(choiceList, element('label', 'handoff-field handoff-instructions-field', t('Your instructions'), instructions))
  const previewLabel = element('span', '', t('Agent prompt preview'))
  previewLabel.id = 'handoff-preview-label'
  const preview = element('pre', 'handoff-preview')
  preview.tabIndex = 0
  preview.setAttribute('role', 'region')
  preview.setAttribute('aria-labelledby', previewLabel.id)
  const field = (label: string, select: HTMLSelectElement) =>
    element('label', 'handoff-field', t(label), select)

  const status = element('p', 'handoff-status')
  status.setAttribute('role', 'status')
  const problem = element('p', 'handoff-error')
  problem.setAttribute('role', 'alert')

  let ticket: IssueDetail | undefined
  let workspaceId: string | undefined
  let discovery = 0
  let starting = false
  function updatePreview() {
    if (!ticket) return
    const included = new Set(choices.filter(input => input.checked).map(input => input.value))
    preview.textContent = handoffPrompt(ticket, included, instructions.value.trim())
  }
  context.addEventListener('input', updatePreview)
  const close = () => {
    discovery++
    dialog.close()
    if (open.isConnected && !open.hidden) open.focus({ preventScroll: true })
  }
  const cancel = button('handoff-button', close, t('Cancel'))
  const start = button('handoff-button handoff-start', async () => {
    if (!ticket || !workspaceId || !agent.value || start.disabled || starting || !dialog.open) return
    const prompt = preview.textContent ?? ''
    starting = true
    start.disabled = cancel.disabled = agent.disabled = context.disabled = true
    problem.textContent = ''
    status.textContent = t('Starting…')
    start.textContent = t('Starting…')
    title.focus({ preventScroll: true })
    try {
      await frame.plugin.request('agent.launch', { workspaceId, agent: agent.value, prompt }, { timeoutMs: 70_000 })
      close()
    } catch (cause) {
      const unknown = 'Launch status is unknown. Check the workspace before trying again.'
      const message = cause instanceof Error ? cause.message : 'Agent launch failed.'
      const uncertain = message === unknown || /timed? out|timeout/i.test(message)
      problem.textContent = translateError(uncertain ? unknown : message, locale)
      start.disabled = agent.disabled = context.disabled = uncertain
      if (!uncertain) start.focus({ preventScroll: true })
    } finally {
      starting = cancel.disabled = false
      status.textContent = ''
      start.textContent = t('Start session')
    }
  }, t('Start session'))
  dialog.addEventListener('cancel', event => {
    event.preventDefault()
    if (!starting) close()
  })
  dialog.append(element('div', 'handoff-content',
    element('header', 'handoff-header', title, source),
    element('div', 'handoff-columns',
      element('div', 'handoff-options', field('Agent', agent), context),
      element('div', 'handoff-field handoff-preview-field', previewLabel, preview)),
    status, problem,
    element('footer', 'handoff-footer', cancel, start)))

  const open = button('handoff-trigger', async () => {
    if (dialog.open || starting || !state.detail) return
    ticket = state.detail
    source.textContent = ticket.title
    workspaceId = undefined
    agent.replaceChildren()
    for (const input of choices) input.checked = input.value !== 'comments'
    instructions.value = ''
    updatePreview()
    preview.scrollTop = 0
    start.disabled = agent.disabled = context.disabled = true
    problem.textContent = ''
    status.textContent = t('Finding available Agents…')
    dialog.showModal()
    title.focus({ preventScroll: true })
    const request = ++discovery
    try {
      const result = await frame.plugin.request('agent.options', undefined, { timeoutMs: 70_000 })
      if (request !== discovery || !dialog.open) return
      if (!result.agents.length) {
        status.textContent = t('No Agents are available for this workspace.')
        return
      }
      for (const item of result.agents) {
        const option = element('option', '', item.default ? `${item.name} (${t('Default')})` : item.name)
        option.value = item.id
        agent.append(option)
      }
      agent.value = (result.agents.find(item => item.default) ?? result.agents[0]).id
      workspaceId = result.workspaceId
      start.disabled = agent.disabled = context.disabled = false
      status.textContent = ''
      if (document.activeElement === title) agent.focus({ preventScroll: true })
    } catch (cause) {
      if (request !== discovery || !dialog.open) return
      status.textContent = ''
      problem.textContent = translateError(cause instanceof Error ? cause.message : 'Could not find Agents.', locale)
    }
  }, t('Start work'))
  open.setAttribute('aria-haspopup', 'dialog')
  return {
    open, dialog,
    update(entry?: IssueDetail | null) {
      open.hidden = !entry
      if (dialog.open && !starting && ticket?.id !== entry?.id) close()
    },
  }
}

function taskDetail() {
  const back = button('detail-back', () => model.back(), icon('back'))
  const backLabel = element('span', 'detail-back-label')
  back.append(backLabel)
  const toolbarTitle = element('span', 'detail-toolbar-title')
  toolbarTitle.hidden = true
  toolbarTitle.setAttribute('aria-hidden', 'true')
  const close = iconButton('close', t('Back to tasks'), () => model.back(true))
  const external = iconButton('external', t('Open in Asana'), () => {
    if (state.detail?.url) void frame.host.call('shell.openExternal', { url: state.detail.url }).catch(console.warn)
  })
  const handoff = agentHandoff()
  const body = element('div', 'detail-body')
  main.append(element('div', 'detail-toolbar', back, toolbarTitle, element('div', 'actions', external, close)), body, handoff.dialog)
  return () => {
    const hasHistory = state.history.length > 0
    backLabel.textContent = t(hasHistory ? 'Back' : 'Back to tasks')
    close.hidden = !hasHistory
    external.hidden = !state.detail?.url
    handoff.update(state.detail)
    if (state.detail) body.replaceChildren(...details(state.detail, handoff.open))
    else body.replaceChildren(...(state.busy ? [skeleton('detail', 5)] : []))
    updateDetailToolbarTitle()
  }
}

function connectionSettings() {
  const input = element('input', 'token-input')
  input.type = 'password'
  input.id = 'asana-token'
  input.maxLength = 8192
  input.autocomplete = 'off'
  input.addEventListener('input', () => model.editToken(input.value))
  const label = element('label', '', t('Personal access token'))
  label.htmlFor = input.id
  const status = element('p', 'muted')
  status.setAttribute('role', 'status')
  const disconnect = button('disconnect', () => model.disconnect(), t('Disconnect'))
  const form = element('form', 'connection', element('h1', '', t('Connection settings')), label, input, status, disconnect)
  form.addEventListener('submit', event => { event.preventDefault(); void model.saveToken() })
  main.append(form)
  return () => {
    input.placeholder = t(state.config?.configured ? 'Replace saved token' : 'Paste your token')
    if (input.value !== state.token) input.value = state.token
    input.readOnly = state.busy
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
    if (screen === 'tasks') { subtaskObserver?.disconnect(); subtaskObserver = undefined }
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
  updateDetailToolbarTitle()
  checkPagination()
}

const workspace = frame.on('workspace.changed', ({ context }) => model.onWorkspace(context?.workspaceId || null))
window.addEventListener('pagehide', () => { subtaskObserver?.disconnect(); subtaskObserver = undefined; subtaskObserverGeneration++; workspace.dispose(); model.dispose(); paginationResize.disconnect() }, { once: true })
void model.reload()
