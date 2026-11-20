import { assert, test, type MockRequests } from 'orca/testing'
import type { PluginBridgeApi } from 'orca/host'
import { createPanelState } from './panel-state'
import { connected, requests, projects, detail } from './fixtures'
import { localeOf, translateError } from './i18n'
import { fieldOptions } from './fields'

function createModel(overrides: MockRequests = {}) {
  const handlers: MockRequests = { ...requests, ...overrides }
  const recorded: { name: string; input: unknown }[] = []
  const request = (async (name: keyof typeof handlers, input?: unknown) => {
    recorded.push({ name, input })
    return (handlers[name] as (input: unknown) => unknown)(input)
  }) as PluginBridgeApi['request']
  return { ...createPanelState(request, () => {}), recorded }
}

const project = projects.items[0]
const bound = { ...connected, binding: project }

test('the default list shows the project PM Priority rather than severity, with saved overrides', () => {
  const custom = [{ id: '57', name: 'PM Priority for CC4 & IC8' }, { id: '58', name: 'PM Priority for CC5' }]
  const visible = fieldOptions('list', custom).filter(field => field.visible).map(field => field.id)
  assert.deepEqual(visible, ['id', 'custom:57', 'status', 'due', 'assignee'])
  const saved = fieldOptions('list', custom, [{ id: 'severity', visible: true }, { id: 'custom:57', visible: false }])
  assert.equal(saved.find(field => field.id === 'severity')?.visible, true)
  assert.equal(saved.find(field => field.id === 'custom:57')?.visible, false)
  assert.equal(fieldOptions('detail', []).find(field => field.id === 'severity')?.visible, true)
})

test('field preferences restore, keep independent order and expose new project fields', async () => {
  const list = [{ id: 'custom:version', visible: true }, { id: 'category', visible: false }]
  const model = createModel({
    'connection.read': () => bound,
    'fields.read': () => ({ list }),
    'fields.save': input => input.layout,
  })
  await model.reload()
  await model.openFields()
  const custom = model.state.fieldCatalog!
  const fields = fieldOptions('list', custom, model.state.fieldLayout.list)
  assert.equal(fields[0].id, 'custom:version')
  assert.equal(fields[1].visible, false)
  assert.equal(fieldOptions('detail', custom).find(field => field.id === 'custom:estimate')?.visible, true)
  await model.saveFields({ list, detail: [{ id: 'priority', visible: false }] })
  assert.equal(model.state.fieldEditor, false)
  assert.deepEqual(model.state.fieldLayout.detail, [{ id: 'priority', visible: false }])
  model.dispose()
})

test('settings save both fields and stay open until the user returns to project search', async () => {
  const model = createModel({
    'connection.read': () => ({ configured: false, url: '' }),
    'connection.save': () => connected,
    'connection.remove': () => ({ configured: false, url: '' }),
  })
  await model.reload()
  assert.equal(model.state.settings, true)
  model.editServer(connected.url)
  model.editToken('test-only-token')
  await model.saveToken()
  assert.equal(model.state.token, '')
  assert.deepEqual(model.recorded.find(({ name }) => name === 'connection.save')?.input, { url: connected.url, token: 'test-only-token' })
  assert.equal(model.state.settings, true)
  await model.toggleSettings()
  assert.deepEqual(model.state.projects, projects.items)
  assert.equal(Boolean(model.state.project), false)
  assert.equal(model.recorded.some(({ name }) => name === 'project.bind'), false)
  await model.bindProject(project)
  assert.equal(model.state.project?.id, project.id)
  assert.equal(model.state.issues[0].id, detail.id)
  await model.toggleSettings()
  await model.disconnect()
  assert.deepEqual(model.state.issues, [])
  assert.equal(model.state.config?.configured, false)
  model.dispose()
})

test('a failed settings save retains edits and localizes the API status', async () => {
  const model = createModel({
    'connection.read': () => ({ configured: false, url: '' }),
    'connection.save': () => { throw Error('API request failed (503).') },
  })
  await model.reload()
  model.editServer('https://mantis.example.test')
  model.editToken('test-only-token')
  await model.saveToken()
  assert.equal(model.state.settings, true)
  assert.equal(model.state.token, 'test-only-token')
  assert.equal(translateError(model.state.problem, localeOf('zh-Hans-CN')), 'API 请求失败（503）。')
  model.editToken('')
  model.dispose()
})

test('restores the binding and remembers the list while navigating an open issue', async () => {
  const model = createModel({
    'connection.read': () => bound,
    'issues.detail': input => input.id === '44'
      ? { ...detail, id: '44', title: 'Check redirect target', description: 'Child task description', subtasks: 0, parent: { id: '42', title: detail.title } }
      : detail,
  })
  await model.reload()
  assert.equal(model.recorded.some(({ name }) => name === 'projects.list'), false)
  model.setQuery('login')
  model.toggleSection('New')
  await model.openTask(detail.id)
  assert.equal(model.state.detail?.id, detail.id)
  await model.openTask('44')
  assert.equal(model.state.detail?.parent?.id, detail.id)
  model.back()
  assert.equal(model.state.detail?.id, detail.id)
  assert.equal(model.state.children[0].id, '44')
  model.back()
  assert.equal(model.state.detail, null)
  assert.equal(model.state.query, 'login')
  assert.ok(model.state.collapsedSections.has('New'))
  model.dispose()
})

test('a reopened sidebar restores the current issue and returning to the list clears it', async () => {
  let selected: string | null = null
  const overrides: MockRequests = {
    'connection.read': () => bound,
    'issues.selection.read': () => ({ id: selected }),
    'issues.selection.save': ({ id }) => { selected = id; return { ok: true } },
    'issues.detail': ({ id }) => ({ ...detail, id, subtasks: 0 }),
  }
  const first = createModel(overrides)
  await first.reload()
  await first.openTask(detail.id)
  await first.openTask('44')
  await first.back()
  assert.equal(selected, detail.id)
  first.dispose()

  const reopened = createModel(overrides)
  await reopened.reload()
  assert.equal(reopened.state.detail?.id, detail.id)
  assert.equal(reopened.recorded.some(request => request.name === 'issues.list'), false)
  await reopened.back(true)
  assert.equal(selected, null)
  assert.equal(reopened.state.issues[0].id, detail.id)
  reopened.dispose()
  const reopenedList = createModel(overrides)
  await reopenedList.reload()
  assert.equal(reopenedList.state.detailId, '')
  reopenedList.dispose()
})

test('an issue that was resolved while the sidebar was closed falls back to the list', async () => {
  const model = createModel({
    'connection.read': () => bound,
    'issues.selection.read': () => ({ id: '44' }),
    'issues.detail': () => { throw Error('This issue was resolved or deleted in MantisBT.') },
  })
  await model.reload()
  assert.equal(model.state.detailId, '')
  assert.equal(model.state.issues[0].id, detail.id)
  assert.deepEqual(model.recorded.find(request => request.name === 'issues.selection.save')?.input,
    { project: project.id, scope: bound.scope, id: null })
  model.dispose()
})

test('requests project matches from MantisBT and avoids rebinding the current project', async () => {
  const model = createModel({
    'connection.read': () => bound,
    'projects.list': input => ({ items: [{ id: '99', name: input.query || 'Initial project' }], next: null }),
  })
  await model.reload()
  await model.chooseProject()
  model.searchProjects('remote match', true)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(model.state.projects[0].name, 'remote match')
  await model.bindProject(project)
  assert.equal(model.state.picker, false)
  assert.equal(model.recorded.some(({ name }) => name === 'project.bind'), false)
  model.dispose()
})

test('Mine and All reuse their own pages, while Refresh fetches them again', async () => {
  const model = createModel({ 'connection.read': () => bound })
  await model.reload()
  model.setQuery('login')
  await model.selectTab('all')
  await model.selectTab('mine')
  assert.equal(model.state.query, 'login')
  assert.deepEqual(model.recorded.filter(({ name }) => name === 'issues.list').map(({ input }) => (input as { tab: string }).tab), ['mine', 'all'])
  await model.refresh()
  assert.equal(model.recorded.filter(({ name }) => name === 'issues.list').length, 3)
  model.dispose()
})

test('Fetch all follows every cursor, including pages with no open issues', async () => {
  const model = createModel({
    'connection.read': () => ({ ...bound, tab: 'all' }),
    'issues.list': ({ cursor }) => {
      if (!cursor) return { items: [detail], next: '2' }
      return cursor === '2' ? { items: [], next: '3' } : { items: [detail, { ...detail, id: '44' }], next: null }
    },
  })
  await model.reload()
  await model.fetchAll()
  assert.deepEqual(model.state.issues.map(issue => issue.id), [detail.id, '44'])
  assert.equal(model.state.next, null)
  assert.equal(model.state.fetchPages, 2)
  assert.equal(model.state.fetchingAll, false)
  model.dispose()
})

test('stopping Fetch all keeps the completed pages and resumes from the pending cursor', async () => {
  let release: () => void = () => {}
  let pageThreeCalls = 0
  const model = createModel({
    'connection.read': () => ({ ...bound, tab: 'all' }),
    'issues.list': async ({ cursor }) => {
      if (!cursor) return { items: [detail], next: '2' }
      if (cursor === '2') return { items: [{ ...detail, id: '44' }], next: '3' }
      if (++pageThreeCalls === 1) await new Promise<void>(resolve => { release = resolve })
      return { items: [{ ...detail, id: '45' }], next: null }
    },
  })
  await model.reload()
  const pending = model.fetchAll()
  await new Promise(resolve => setTimeout(resolve, 0))
  model.stopFetchAll()
  release()
  await pending
  assert.deepEqual(model.state.issues.map(issue => issue.id), [detail.id, '44'])
  assert.equal(model.state.next, '3')
  await model.fetchAll()
  assert.deepEqual(model.state.issues.map(issue => issue.id), [detail.id, '44', '45'])
  model.dispose()
})

test('a same-project workspace switch keeps an issue that is loading', async () => {
  let answer: (value: typeof detail) => void = () => {}
  const model = createModel({
    'connection.read': () => bound,
    'issues.detail': () => new Promise<typeof detail>(resolve => { answer = resolve }),
  })
  model.onWorkspace('worktree-a')
  await model.reload()
  const opened = model.openTask(detail.id)
  model.onWorkspace('worktree-b')
  answer(detail)
  await opened
  assert.equal(model.state.busy, false)
  assert.equal(model.state.detail?.id, detail.id)
  assert.equal(model.recorded.filter(({ name }) => name === 'issues.detail').length, 1)
  model.dispose()
})
