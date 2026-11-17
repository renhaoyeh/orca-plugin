import test from 'node:test'
import assert from 'node:assert/strict'
import { asanaClient } from './asana-client.mjs'
const json = body => new Response(JSON.stringify(body))
const task = (gid, project = '12') => ({ gid, name: 'Task ' + gid, memberships: [{ project: { gid: project }, section: { name: 'Doing' } }], due_on: '2027-01-01', assignee: { name: 'Demo' }, num_subtasks: 2, custom_fields: [{ gid: 'priority', name: 'Priority', resource_subtype: 'enum', display_value: 'High', enum_value: { name: 'High', color: 'red' } }] })
test('project search uses original Asana workspace typeahead, not a filter of an initial project page', async () => {
  const seen = []
  const api = asanaClient('asana', { token: 'test-only-token' }, async value => {
    const url = new URL(value); seen.push(url)
    if (url.pathname.endsWith('/users/me')) return json({ data: { gid: '7', workspaces: [{ gid: '1', name: 'Work' }] } })
    assert.equal(url.pathname, '/api/1.0/workspaces/1/typeahead')
    assert.equal(url.searchParams.get('resource_type'), 'project')
    assert.equal(url.searchParams.get('query'), 'remote project')
    return json({ data: [{ gid: '12', name: 'A remotely matched project' }] })
  })
  const result = await api.projects(null, 'remote project')
  assert.equal(result.items[0].workspaceId, '1'); assert.equal(result.items[0].workspaceName, 'Work')
  assert.equal(seen.length, 2)
})
test('Mine fetches all assigned open tasks in the workspace, then filters project membership', async () => {
  let pages = 0
  const api = asanaClient('asana', { token: 'test-only-token' }, async value => {
    const url = new URL(value)
    if (url.pathname.endsWith('/projects/12')) return json({ data: { gid: '12', workspace: { gid: '1' } } })
    assert.equal(url.pathname, '/api/1.0/tasks')
    assert.equal(url.searchParams.get('assignee'), 'me'); assert.equal(url.searchParams.get('workspace'), '1')
    assert.equal(url.searchParams.get('completed_since'), 'now')
    pages++
    return json({ data: pages === 1 ? [task('42'), task('90', '99')] : [task('43')], next_page: pages === 1 ? { offset: 'next' } : null })
  })
  const result = await api.issues('12', null, 'mine')
  assert.equal(pages, 2); assert.deepEqual(result.items.map(item => item.id), ['42', '43'])
  assert.equal(result.items[0].section, 'Doing'); assert.equal(result.items[0].due, '2027-01-01')
  assert.equal(result.items[0].customFields[0].displayValue, 'High')
  assert.equal(result.items[0].customFields[0].color, 'red')
})
test('All loads one original open-task page and preserves Asana offset semantics', async () => {
  const api = asanaClient('asana', { token: 'test-only-token' }, async value => {
    const url = new URL(value)
    assert.equal(url.pathname, '/api/1.0/projects/12/tasks')
    assert.equal(url.searchParams.get('completed_since'), 'now'); assert.equal(url.searchParams.get('offset'), 'opaque next')
    return json({ data: [task('42')], next_page: { offset: 'last' } })
  })
  const result = await api.issues('12', 'opaque next', 'all')
  assert.equal(result.next, 'last'); assert.equal(result.items[0].subtasks, 2)
})
test('subtasks use original all-page traversal and exclude completed children', async () => {
  let pages = 0
  const api = asanaClient('asana', { token: 'test-only-token' }, async value => {
    const url = new URL(value); assert.equal(url.pathname, '/api/1.0/tasks/42/subtasks')
    pages++
    return json({ data: pages === 1 ? [{ ...task('43'), completed: false }, { ...task('44'), completed: true }] : [{ ...task('45'), completed: false }], next_page: pages === 1 ? { offset: 'next' } : null })
  })
  assert.deepEqual((await api.subtasks('42')).map(item => item.id), ['43', '45'])
  assert.equal(pages, 2)
})

test('details use original notes and comments projection, traversing all comment pages; completed tasks are rejected', async () => {
  let completed = false, stories = 0
  const api = asanaClient('asana', { token: 'test-only-token' }, async value => {
    const url = new URL(value)
    if (url.pathname.endsWith('/stories')) {
      stories++; return json({ data: [{ gid: String(stories), resource_subtype: 'comment_added', text: 'Comment ' + stories, created_by: { name: 'Demo' } }], next_page: stories === 1 ? { offset: 'next' } : null })
    }
    return json({ data: { ...task('42'), notes: 'Original task notes', completed, parent: { gid: '41', name: 'Parent task' } } })
  })
  const detail = await api.detail('42', '12')
  assert.equal(detail.description, 'Original task notes'); assert.equal(detail.comments.length, 2)
  assert.equal(detail.section, 'Doing')
  assert.equal(detail.parent.id, '41')
  assert.equal(detail.customFields[0].name, 'Priority')
  completed = true
  await assert.rejects(api.detail('42'), /completed or deleted/)
})
