import test from 'node:test'
import assert from 'node:assert/strict'
import { mantisClient } from './mantis-client.mjs'
let serial = 0
const config = () => ({ url: `https://mantis-${++serial}.example.test`, token: 'test-only-token' })
const json = body => new Response(JSON.stringify(body))
const row = (id = 42, status = 45, project = 12) => ({ id, summary: `Issue ${id}`, project: { id: project, name: 'Project' }, status: { id: status, name: 'assigned', label: 'Assigned', color: '#c2dfff' }, priority: { id: 50, name: 'high' }, severity: { name: 'major' }, category: { name: 'Login' }, handler: { name: 'demo', real_name: 'Demo User' }, reporter: { name: 'reporter' }, resolution: { name: 'open' }, reproducibility: { name: 'always' }, view_state: { name: 'private' }, tags: [{ name: 'regression' }], custom_fields: [{ field: { id: 7, name: 'Release date' }, value: '1704067200' }] })
const auxiliary = url => url.pathname.endsWith('/config') ? { configs: [{ option: 'bug_resolved_status_threshold', value: 50 }] } : { projects: [{ id: 12, name: 'Project', custom_fields: [{ field: { id: 7, name: 'Release date' }, type: { name: 'date' } }] }] }
test('original Mantis validation accepts flat users/me and project search flattens/deduplicates nested subprojects', async () => {
  let projectReads = 0
  const api = mantisClient('mantisbt', config(), async value => {
    const url = new URL(value)
    if (url.pathname.endsWith('/users/me')) return json({ id: 7, name: 'demo' })
    projectReads++
    return json({ projects: [{ id: 12, name: 'Main', subProjects: [{ id: 13, name: 'Child' }] }, { id: 13, name: 'Child' }] })
  })
  await api.validate()
  assert.equal((await api.projects()).items.length, 2)
  const result = await api.projects(null, 'Main Child')
  assert.equal(result.items[0].id, '13'); assert.equal(result.items[0].workspaceName, 'Main')
  assert.equal(projectReads, 1)
})
test('All uses the server resolved threshold, exact project membership and original 20-row pagination; typed metadata survives', async () => {
  const api = mantisClient('mantisbt', config(), async value => {
    const url = new URL(value)
    if (!url.pathname.endsWith('/issues')) return json(auxiliary(url))
    assert.equal(url.searchParams.get('page_size'), '20'); assert.equal(url.searchParams.get('page'), '1')
    return json({ issues: [row(), row(43, 60), row(44, 45, 13), ...Array.from({ length: 17 }, (_, i) => row(100 + i, 60))] })
  })
  const page = await api.issues('12', null, 'all')
  assert.equal(page.next, '2'); assert.equal(page.items.length, 1)
  const item = page.items[0]
  assert.equal(item.priorityId, 50); assert.equal(item.severity, 'major'); assert.equal(item.category, 'Login')
  assert.equal(item.reporter, 'reporter'); assert.equal(item.viewStatus, 'private'); assert.deepEqual(item.tags, ['regression'])
  assert.match(item.customFields[0].displayValue, /^\d{4}-\d{2}-\d{2}$/)
  await assert.rejects(api.issues('../12', null, 'all'), /Invalid/)
  await assert.rejects(api.issues('12', 'bad', 'all'), /Invalid/)
})
test('Mine sends assigned filter and traverses even a fully resolved first page', async () => {
  let pages = 0
  const api = mantisClient('mantisbt', config(), async value => {
    const url = new URL(value)
    if (!url.pathname.endsWith('/issues')) return json(auxiliary(url))
    assert.equal(url.searchParams.get('filter_id'), 'assigned'); pages++
    return json({ issues: pages === 1 ? Array.from({ length: 20 }, (_, i) => row(i + 1, 60)) : [row(99)] })
  })
  assert.deepEqual((await api.issues('12', null, 'mine')).items.map(item => item.id), ['99'])
  assert.equal(pages, 2)
})
test('internal details retain notes, steps, custom fields, sorted comments and parent/child relationships', async () => {
  const api = mantisClient('mantisbt', config(), async value => {
    const url = new URL(value)
    if (!/\/issues\/\d+$/.test(url.pathname)) return json(auxiliary(url))
    const id = Number(url.pathname.split('/').at(-1))
    return json({ issues: [{ ...row(id, id === 45 ? 60 : 45), description: id === 44 ? 'D'.repeat(16001) : 'Description', steps_to_reproduce: 'Open login', additional_information: 'Windows', notes: [{ id: 2, text: 'Later', created_at: '2020-01-02', reporter: { name: 'Reporter' } }, { id: 1, text: 'Earlier', created_at: '2020-01-01' }], relationships: id === 42 ? [{ type: { name: 'child-of' }, issue: { id: 41, summary: 'Parent' } }, { type: { name: 'parent-of' }, issue: { id: 44 } }, { type: { name: 'parent-of' }, issue: { id: 45 } }] : [] }] })
  })
  const detail = await api.detail('42')
  assert.equal(detail.parent.id, '41'); assert.equal(detail.subtasks, 2)
  assert.match(detail.description, /Steps to reproduce:\nOpen login/)
  assert.match(detail.description, /Additional information:\nWindows/)
  assert.equal(detail.comments[0].text, 'Earlier'); assert.equal(detail.comments[0].at, '2020-01-01')
  assert.deepEqual((await api.subtasks('42')).map(item => item.id), ['44'])
  const longDetail = await api.detail('44')
  assert.equal(longDetail.description.length, 16000)
  assert.equal(longDetail.reproductionSteps, 'Open login')
  await assert.rejects(api.detail('45'), /resolved or deleted/)
})
test('deleted issues and unavailable server configuration are reported instead of silently inventing status thresholds', async () => {
  const api = mantisClient('mantisbt', config(), async value => new URL(value).pathname.includes('/issues/') ? new Response('', { status: 404 }) : json({ configs: [] }))
  await assert.rejects(api.detail('42'), /resolved or deleted/)
  await assert.rejects(api.issues('12', null, 'all'), /resolved status setting|did not return/)
})
