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

test('one paginated task story traversal separates comments and system activity', async () => {
  let completed = false, attachmentCalls = 0, storyCalls = 0
  const api = asanaClient('asana', { token: 'test-only-token' }, async value => {
    const url = new URL(value)
    if (url.pathname.endsWith('/stories')) {
      storyCalls++
      assert.equal(url.searchParams.has('resource_subtype'), false)
      assert.match(url.searchParams.get('opt_fields'), /resource_subtype/)
      assert.match(url.searchParams.get('opt_fields'), /created_by\.name/)
      const start = url.searchParams.get('offset') === 'next' ? 30 : 0
      const end = start ? 35 : 30
      const comments = Array.from({ length: end - start }, (_, index) => {
        const number = start + index + 1
        return { gid: String(number), resource_subtype: 'comment_added', text: 'Comment ' + number, created_at: new Date(Date.UTC(2026, 0, number)).toISOString(), created_by: { name: 'Demo' } }
      })
      const system = start
        ? [
          { gid: 'section-1', resource_subtype: 'section_changed', created_at: '2026-02-02T00:00:00.000Z', created_by: { name: 'Section actor' } },
          { gid: 'empty-comment', resource_subtype: 'comment_added', text: '  ', created_by: { name: 'No comment' } },
        ]
        : [
          ...Array.from({ length: 30 }, (_, index) => ({ gid: `noise-${index + 1}`, resource_subtype: 'assigned', text: 'Assignment updated', created_at: new Date(Date.UTC(2025, 11, index + 1)).toISOString(), created_by: { name: 'History actor' } })),
          { gid: 'assignment-1', resource_subtype: 'assigned', text: 'Assigned to Demo', created_at: '2026-01-15T00:00:00.000Z', created_by: { name: 'Assigner' } },
          { gid: 'due-1', resource_subtype: 'due_date_changed', text: 'Changed due date', created_at: '2026-01-31T00:00:00.000Z', created_by: { name: 'Planner' } },
        ]
      return json({ data: [...comments, ...system], next_page: start ? null : { offset: 'next' } })
    }
    if (url.pathname.endsWith('/attachments')) { attachmentCalls++; return json({ data: [], next_page: null }) }
    return json({ data: { ...task('42'), notes: 'Original task notes', completed, parent: { gid: '41', name: 'Parent task' } } })
  })
  const detail = await api.detail('42', '12')
  assert.equal(detail.description, 'Original task notes'); assert.equal(detail.comments.length, 30)
  assert.deepEqual(detail.comments.slice(0, 2).map(comment => comment.id), ['1', '2'])
  assert.equal(detail.section, 'Doing')
  assert.equal(detail.parent.id, '41')
  assert.equal(detail.customFields[0].name, 'Priority')
  assert.equal(detail.comments.length, 30)
  assert.equal(detail.activities.length, 30)
  assert.deepEqual(detail.activities.slice(-3).map(activity => activity.id), ['assignment-1', 'due-1', 'section-1'])
  assert.equal(detail.activities.at(-1).subtype, 'section_changed')
  assert.equal(detail.activities.at(-1).author, 'Section actor')
  assert.equal(detail.activities.at(-1).text, '')
  assert.equal(detail.activities.at(-1).fallback, 'Section Changed')
  assert.equal(detail.activitiesTruncated, true)
  assert.equal(detail.truncated, true)
  assert.equal(storyCalls, 2)
  const mcpDetail = await api.detail('42', '12', { includeAllComments: true, includeImages: false })
  assert.equal(mcpDetail.comments.length, 30)
  assert.deepEqual(mcpDetail.comments.slice(-5).map(comment => comment.id), ['31', '32', '33', '34', '35'])
  assert.equal(mcpDetail.activities.length, 30)
  assert.deepEqual(mcpDetail.activities.slice(-3).map(activity => activity.subtype), ['assigned', 'due_date_changed', 'section_changed'])
  assert.equal(storyCalls, 4)
  assert.equal(attachmentCalls, 1)
  completed = true
  await assert.rejects(api.detail('42'), /completed or deleted/)
})

test('activity stories with missing text remain activities and a story failure reports both collections', async () => {
  let storyFailure = false
  const api = asanaClient('asana', { token: 'test-only-token' }, async value => {
    const url = new URL(value)
    if (url.pathname.endsWith('/stories')) return storyFailure
      ? new Response('{}', { status: 503 })
      : json({ data: [
        { gid: 'comment-empty', resource_subtype: 'comment_added', text: '   ' },
        { gid: 'event-empty', resource_subtype: 'due_date_changed' },
        { gid: 'invalid-event', text: 'No subtype, so not valid activity' },
      ] })
    return json({ data: { ...task('42'), notes: '', completed: false } })
  })
  const detail = await api.detail('42')
  assert.deepEqual(detail.comments, [])
  assert.equal(detail.activities.length, 1)
  assert.equal(detail.activities[0].id, 'event-empty')
  assert.equal(detail.activities[0].text, '')
  assert.equal(detail.activities[0].fallback, 'Due Date Changed')
  assert.equal(detail.activities[0].author, 'Someone')
  assert.equal(detail.activities[0].at, null)
  storyFailure = true
  const failed = await api.detail('42')
  assert.equal(failed.commentsError, 'Comments could not be loaded. Refresh to retry.')
  assert.equal(failed.activitiesError, 'Activities could not be loaded. Refresh to retry.')
})

test('system activity truncation is separate from shortened notes and comments', async () => {
  const api = asanaClient('asana', { token: 'test-only-token' }, async value => {
    const url = new URL(value)
    if (url.pathname.endsWith('/stories')) return json({ data: [
      { gid: 'comment', resource_subtype: 'comment_added', text: 'Short comment' },
      ...Array.from({ length: 31 }, (_, index) => ({ gid: `event-${index}`, resource_subtype: 'assigned', text: 'Short event' })),
    ] })
    return json({ data: { ...task('42'), notes: 'Short notes', completed: false } })
  })
  const detail = await api.detail('42', null, { includeImages: false })
  assert.equal(detail.comments.length, 1)
  assert.equal(detail.activities.length, 30)
  assert.equal(detail.activitiesTruncated, true)
  assert.equal(detail.commentsTruncated, false)
  assert.equal(detail.truncated, false)
})
