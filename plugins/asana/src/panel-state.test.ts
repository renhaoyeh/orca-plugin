import { assert, test, type MockRequests } from 'orca/testing'
import type { PluginBridgeApi } from 'orca/host'
import { createPanelState } from './panel-state'
import { connected, requests, projects, detail } from './fixtures'

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

test('saving a token opens project search and waits for an explicit binding', async () => {
  const model = createModel({
    'connection.read': () => ({ configured: false, url: '' }),
    'connection.save': () => connected,
    'connection.remove': () => ({ configured: false, url: '' }),
  })
  await model.reload()
  assert.equal(model.state.settings, true)
  model.editToken('test-only-token')
  await model.saveToken()
  assert.equal(model.state.token, '')
  assert.deepEqual(model.state.projects, projects.items)
  assert.equal(Boolean(model.state.project), false)
  assert.equal(model.recorded.some(({ name }) => name === 'project.bind'), false)
  await model.bindProject(project)
  assert.equal(model.state.project?.id, project.id)
  assert.equal(model.state.issues[0].id, detail.id)
  await model.disconnect()
  assert.deepEqual(model.state.issues, [])
  assert.equal(model.state.config?.configured, false)
  model.dispose()
})

test('restores the binding and remembers the list while navigating an open task', async () => {
  const model = createModel({
    'connection.read': () => bound,
    'issues.detail': input => input.id === '44'
      ? { ...detail, id: '44', title: 'Check redirect target', description: 'Child task description', subtasks: 0, parent: { id: '42', title: detail.title } }
      : detail,
  })
  await model.reload()
  assert.equal(model.recorded.some(({ name }) => name === 'projects.list'), false)
  model.setQuery('login')
  model.toggleSection('Backlog')
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
  assert.ok(model.state.collapsedSections.has('Backlog'))
  model.dispose()
})

test('requests project matches from Asana and avoids rebinding the current project', async () => {
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

test('a same-project workspace switch keeps a task that is loading', async () => {
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
