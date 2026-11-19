import { env, atom, read, set, plugin, host, on, Stack, Row, Heading, Text, Input, Button, IconButton, List, ListItem, Callout, Spinner, Badge, Separator, type PanelContext } from 'orca'
import { localeOf, translate, translateError } from './i18n'
import type { ConnectionState, Project, Issue, IssueDetail, Page } from './protocol'
import { sectionTone, fieldTone, dueTone, dateLabel } from './presentation'
const config = atom<ConnectionState | null>(null), settings = atom(false), busy = atom(false), problem = atom(''), status = atom('')
const token = atom(''), projects = atom<Project[]>([]), project = atom<Project | null>(null), picker = atom(true), projectQuery = atom('')
const issues = atom<Issue[]>([]), next = atom<string | null>(null), query = atom(''), tab = atom<'mine' | 'all'>('mine')
const detailId = atom(''), detail = atom<IssueDetail | null>(null), children = atom<Issue[]>([])
const history = atom<{ detail: IssueDetail; children: Issue[] }[]>([])
const cache = new Map<string, Page<Issue>>()
let generation = 0, searchTimer: ReturnType<typeof setTimeout> | undefined, saveTimer: ReturnType<typeof setTimeout> | undefined
let pendingSearch = false, pendingSave = false
async function run(action: (current: () => boolean) => Promise<void>) {
  if (read(busy)) return
  const request = ++generation
  set(busy, true); set(problem, '')
  try { await action(() => request === generation) }
  catch (error) { if (request === generation) set(problem, error instanceof Error ? error.message : String(error)) }
  finally {
    if (request === generation) {
      set(busy, false)
      if (pendingSave) { pendingSave = false; void saveToken() }
      else if (pendingSearch) { pendingSearch = false; void run(loadProjects) }
    }
  }
}
async function loadProjects(current: () => boolean) {
  const value = read(projectQuery)
  const page = await plugin.request('projects.list', { cursor: null, query: value })
  if (current() && value === read(projectQuery)) set(projects, page.items)
}
function searchProjects(value: string, immediate = false) {
  set(projectQuery, value); clearTimeout(searchTimer)
  const go = () => { if (read(busy)) pendingSearch = true; else void run(loadProjects) }
  if (immediate) go(); else searchTimer = setTimeout(go, 350)
}
async function loadIssues(current: () => boolean, more = false, refresh = false) {
  const bound = read(project)
  if (!bound) return
  const key = JSON.stringify([bound.id, read(tab)])
  if (!more && cache.has(key) && !refresh) {
    const page = cache.get(key)!; set(issues, page.items); set(next, page.next); return
  }
  if (!more) { set(issues, []); set(next, null) }
  const page = await plugin.request('issues.list', { project: bound.id, cursor: more ? read(next) : null, tab: read(tab) })
  if (!current()) return
  const items = more ? [...new Map([...read(issues), ...page.items].map(item => [item.id, item])).values()] : page.items
  cache.set(key, { items, next: page.next }); set(issues, items); set(next, page.next)
}
async function choose(bound: Project) {
  await run(async current => {
    const saved = await plugin.request('project.bind', { scope: read(config)?.scope || 'source:asana', id: bound.id })
    if (!current()) return
    set(project, saved); set(picker, false); set(query, ''); set(detailId, ''); set(detail, null); set(children, []); set(history, [])
    await loadIssues(current)
  })
}
async function loadDetail(current: () => boolean, id: string) {
  set(children, [])
  const value = await plugin.request('issues.detail', { id, project: read(project)?.id })
  if (!current()) return
  set(detail, value)
  if (value.subtasks) {
    const rows = await plugin.request('issues.subtasks', { id })
    if (current()) set(children, rows)
  }
}
async function navigateDetail(id: string) {
  if (read(busy) || id === read(detailId)) return
  const entry = read(detail)
  if (entry) set(history, [...read(history).slice(-29), { detail: entry, children: read(children) }])
  await run(async current => { set(detailId, id); set(detail, null); await loadDetail(current, id) })
}
async function saveToken() {
  clearTimeout(saveTimer)
  if (!read(token).trim()) return
  if (read(busy)) { pendingSave = true; return }
  await run(async current => {
    const wasConnected = !!read(config)?.configured
    const saved = await plugin.request('connection.save', { url: '', token: read(token) })
    if (!current()) return
    set(token, ''); set(config, saved); set(status, 'Saved'); cache.clear()
    set(project, saved.binding || null); set(detailId, ''); set(detail, null); set(issues, []); set(next, null); set(children, []); set(history, [])
    set(picker, !saved.binding)
    if (!wasConnected) set(settings, false)
    if (!read(settings)) { if (saved.binding) await loadIssues(current); else await loadProjects(current) }
  })
}
function editToken(value: string) {
  set(token, value); set(status, ''); clearTimeout(saveTimer)
  if (value.trim()) saveTimer = setTimeout(() => { void saveToken() }, 650)
}
async function reload() {
  clearTimeout(searchTimer); clearTimeout(saveTimer); pendingSearch = false; pendingSave = false
  generation++; set(busy, false)
  await run(async current => {
    const saved = await plugin.request('connection.read')
    if (!current()) return
    set(config, saved); set(settings, !saved.configured); set(token, ''); set(status, '')
    set(project, saved.binding || null); set(tab, saved.tab || 'mine'); set(picker, !saved.binding)
    set(detailId, ''); set(detail, null); set(issues, []); set(next, null); set(query, ''); set(children, []); set(history, []); cache.clear()
    if (saved.configured) { if (saved.binding) await loadIssues(current); else await loadProjects(current) }
  })
}
export function setup(ctx: PanelContext) {
  let workspace: string | null | undefined
  ctx.subscriptions.push(on('workspace.changed', ({ context }) => {
    const id = context?.workspaceId || null
    if (workspace === id) return
    workspace = id
    if (!read(settings)) void reload()
  }))
  void host.call('workspace.readContext', {}).then(value => { if (workspace === undefined) workspace = value?.workspaceId || null }).catch(() => {})
  void reload()
  return () => {
    clearTimeout(searchTimer); clearTimeout(saveTimer); pendingSearch = false; pendingSave = false
    if (read(token).trim() && !read(busy)) void plugin.request('connection.save', { url: '', token: read(token) }).catch(() => {})
    generation++; set(token, '')
  }
}
export default function Panel() {
  const locale = localeOf(env.locale)
  const t = (source: string, values?: Record<string, number>) => translate(source, locale, values)
  const formatDate = (value: string) => dateLabel(value, locale)
  const saved = read(config), pending = read(busy), bound = read(project), entry = read(detail)
  const words = read(query).toLowerCase().split(/\s+/).filter(Boolean)
  const rows = read(issues).filter(item => words.every(word => `${item.title} ${item.assignee} ${item.section || ''}`.toLowerCase().includes(word)))
  const groups = [...new Set(rows.map(item => item.section || ''))]
  return <Stack gap="md">
    <Row justify="between" align="center">
      <Heading level={2}>Asana</Heading>
      <Row gap="xs">
        {saved?.configured && <IconButton icon="refresh" label={t('Refresh')} variant="ghost" disabled={pending} onPress={() => run(current => read(detailId) ? loadDetail(current, read(detailId)) : read(picker) ? loadProjects(current) : loadIssues(current, false, true))} />}
        <IconButton icon="settings" label={t('Connection settings')} variant="ghost" disabled={pending} onPress={() => { if (!read(settings)) set(settings, true); else if (read(token).trim()) { void saveToken(); set(settings, false) } else void reload() }} />
      </Row>
    </Row>
    {read(problem) && <Callout tone="danger">{translateError(read(problem), locale)}</Callout>}
    {read(settings) ? <Stack gap="md">
      <Input label={t('Personal access token')} type="password" placeholder={saved?.configured ? t('Replace saved token') : t('Paste your token')} value={read(token)} maxLength={8192} disabled={pending} onChange={editToken} onSubmit={() => saveToken()} />
      <Text muted size="sm">{t(pending ? 'Saving…' : read(status) || 'Changes save automatically.')}</Text>
      {saved?.configured && <Button variant="ghost" disabled={pending} onPress={() => run(async current => {
        clearTimeout(saveTimer)
        const value = await plugin.request('connection.remove')
        if (current()) { set(config, value); set(token, ''); set(project, null); set(issues, []); set(detail, null); set(detailId, ''); set(status, 'Token cleared'); cache.clear() }
      })}>{t('Disconnect')}</Button>}
    </Stack> : saved?.configured && <Stack gap="md">
      {read(picker) ? <Stack gap="md">
        {bound && <Button variant="ghost" disabled={pending} onPress={() => set(picker, false)}>{t('Back to tasks')}</Button>}
        <Input label={t('Search projects')} type="search" value={read(projectQuery)} onChange={value => searchProjects(value)} onSubmit={value => searchProjects(value, true)} />
        <List label={t('Projects')}>{read(projects).map(item => <ListItem key={item.id} title={item.name} description={item.workspaceName} current={item.id === bound?.id} icon="folder" disabled={pending} onPress={() => choose(item)} />)}</List>
        {!pending && read(projects).length === 0 && <Text muted>{t('No matching projects.')}</Text>}
      </Stack> : read(detailId) ? <Stack gap="md">
        <Row justify="between" align="center">
          <Button variant="ghost" disabled={pending} onPress={() => {
            const trail = [...read(history)], previous = trail.pop()
            set(problem, ''); set(history, trail)
            if (previous) { set(detailId, previous.detail.id); set(detail, previous.detail); set(children, previous.children) }
            else { set(detailId, ''); set(detail, null); set(children, []) }
          }}>{read(history).length ? t('Back') : t('Back to tasks')}</Button>
          {entry?.url && <IconButton icon="open-external" label={t('Open original')} variant="ghost" onPress={() => host.call('shell.openExternal', { url: entry.url })} />}
        </Row>
        {entry && <Stack gap="md">
          <Row gap="sm" align="center"><Badge tone={sectionTone(entry.section || '')}>{entry.section || t('No section')}</Badge><Text muted size="xs">#{entry.id}</Text></Row>
          <Heading level={3}>{entry.title}</Heading>
          {entry.parent && <Button variant="ghost" disabled={pending} onPress={() => navigateDetail(entry.parent!.id)}>{`↳ ${entry.parent.title}`}</Button>}
          <Stack gap="sm">
            <Row gap="sm" justify="between"><Text muted size="sm">{t('Assignee')}</Text><Text size="sm">{entry.assignee || t('Unassigned')}</Text></Row>
            <Row gap="sm" justify="between"><Text muted size="sm">{t('Due date')}</Text><Text size="sm" tone={dueTone(entry.due || '')}>{entry.due ? formatDate(entry.due) : '—'}</Text></Row>
            <Row gap="sm" justify="between"><Text muted size="sm">{t('Project')}</Text><Text size="sm">{bound?.name || '—'}</Text></Row>
            {(entry.customFields || []).map(field => <Stack key={field.id} gap="xs">
              <Text muted size="xs">{field.name}</Text>
              {['enum', 'multi_enum'].includes(field.type) ? <Badge tone={fieldTone(field.color, field.displayValue)}>{field.displayValue || '—'}</Badge> : <Text size="sm">{field.displayValue || '—'}</Text>}
            </Stack>)}
          </Stack>
          <Separator />
          <Heading level={3}>{t('Description')}</Heading>
          <Text>{entry.description || t('No description.')}</Text>
          {!!entry.subtasks && <Stack gap="sm">
            <Heading level={3}>{t('Subtasks')}</Heading>
            <List label={t('Subtasks')}>{read(children).map(item => <ListItem key={item.id} title={item.title} description={[item.assignee, item.due ? formatDate(item.due) : ''].filter(Boolean).join(' · ')} disabled={pending} onPress={() => navigateDetail(item.id)} />)}</List>
            {!pending && !read(children).length && <Text muted size="sm">{t('No open subtasks.')}</Text>}
          </Stack>}
          <Separator />
          <Heading level={3}>{t('Comments')}</Heading>
          {entry.commentsError && <Text muted size="sm">{t(entry.commentsError)}</Text>}
          {!entry.commentsError && !entry.comments.length && <Text muted>{t('No comments.')}</Text>}
          {entry.comments.map(item => <Stack key={item.id} gap="xs"><Row gap="sm" justify="between"><Text weight="medium" size="sm" tone="accent">{item.author}</Text>{item.at && <Text muted size="xs">{formatDate(item.at)}</Text>}</Row><Text size="sm">{item.text}</Text></Stack>)}
          {entry.truncated && <Text muted size="xs">{t('Preview shortened. Open original for the full content.')}</Text>}
        </Stack>}
      </Stack> : <Stack gap="md">
        <Button variant="ghost" icon="folder" disabled={pending} onPress={() => run(async current => { set(picker, true); await loadProjects(current) })}>{bound?.name || t('Choose Asana project')}</Button>
        <Row gap="sm">{(['mine', 'all'] as const).map(value => <Button key={value} variant={read(tab) === value ? 'outline' : 'ghost'} tone={read(tab) === value ? 'accent' : 'neutral'} disabled={pending} onPress={() => run(async current => { await plugin.request('view.save', { tab: value }); if (!current()) return; set(tab, value); await loadIssues(current) })}>{value === 'mine' ? t('Mine') : t('All')}</Button>)}</Row>
        <Input label={t('Filter tasks')} type="search" value={read(query)} onChange={value => set(query, value)} />
        {groups.map(section => <Stack key={section} gap="sm">
          <Row gap="sm" align="center"><Badge tone={sectionTone(section)}>{section || t('No section')}</Badge><Text muted size="xs">{String(rows.filter(item => (item.section || '') === section).length)}</Text></Row>
          <List label={section || t('No section')}>{rows.filter(item => (item.section || '') === section).map(item => <ListItem key={item.id} title={item.title} description={item.assignee || t('Unassigned')} disabled={pending} onPress={() => run(async current => { set(history, []); set(detailId, item.id); set(detail, null); await loadDetail(current, item.id) })}>
            <Row gap="sm" align="center">
              {item.due && <Text size="xs" tone={dueTone(item.due)}>{formatDate(item.due)}</Text>}
              {!!item.subtasks && <Badge>{t(item.subtasks === 1 ? '{count} subtask' : '{count} subtasks', { count: item.subtasks })}</Badge>}
            </Row>
          </ListItem>)}</List>
        </Stack>)}
        {!pending && !rows.length && <Text muted>{t('No tasks found.')}</Text>}
        {read(next) && read(tab) === 'all' && <Button variant="ghost" disabled={pending} onPress={() => run(current => loadIssues(current, true))}>{t('Load more')}</Button>}
      </Stack>}
    </Stack>}
    {pending && <Spinner label={t('Loading')} />}
  </Stack>
}
