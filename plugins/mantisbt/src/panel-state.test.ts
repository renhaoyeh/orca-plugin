import { assert, test, type MockRequests } from 'orca/testing'
import type { PluginBridgeApi } from 'orca/host'
import { createPanelState } from './panel-state'
import { connected, requests, projects, detail } from './fixtures'
import { localeOf, translateError } from './i18n'

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
