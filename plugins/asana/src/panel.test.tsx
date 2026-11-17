import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { connected, requests, projects, detail } from './fixtures'
test('token settings save on submit without Connect, then wait for an explicit project choice', async () => {
  let bindings = 0, saved: unknown
  const view = await mount(panel, { host: mockHost({ requests: {
    ...requests, 'connection.read': () => ({ configured: false, url: '' }),
    'connection.save': input => { saved = input; return connected },
    'project.bind': () => { bindings++; return projects.items[0] },
  } }) })
  assert.equal(view.find({ label: 'Personal access token' })?.props.type, 'password')
  assert.equal(view.find({ text: 'Connect' }), null)
  await view.type({ label: 'Personal access token' }, 'test-only-token', { replace: true, submit: true })
  assert.ok(saved); assert.equal(bindings, 0)
  assert.ok(view.find({ label: 'Demo project' }))
  assert.equal(view.find({ label: 'Fix login redirect' }), null)
  await view.press({ label: 'Demo project' })
  assert.equal(bindings, 1); assert.ok(view.find({ label: 'Fix login redirect' }))
  await view.press({ label: 'Connection settings' })
  assert.equal(view.valueOf({ label: 'Personal access token' }), '')
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, [])
  await view.unmount()
})
test('restores the saved project and opens Mine with original Section grouping', async () => {
  let searches = 0
  const view = await mount(panel, { host: mockHost({ requests: {
    ...requests, 'connection.read': () => ({ ...connected, binding: projects.items[0] }),
    'projects.list': () => { searches++; return projects },
    'issues.list': input => { assert.equal(input.tab, 'mine'); return requests['issues.list']() },
  } }) })
  assert.equal(searches, 0)
  assert.ok(view.find({ label: 'Fix login redirect' }))
  assert.ok(view.find({ type: 'Badge', text: 'In progress' }))
  assert.ok(view.find({ type: 'Badge', text: 'Backlog' }))
  await view.unmount()
})
test('project search queries the source instead of filtering only already loaded projects', async () => {
  let searched = ''
  const view = await mount(panel, { host: mockHost({ requests: {
    ...requests, 'projects.list': input => { searched = input.query || ''; return { items: [{ id: '99', name: searched ? 'Remote match' : 'Initial project' }], next: null } },
  } }) })
  await view.type({ label: 'Search projects' }, 'new query', { replace: true, submit: true })
  assert.equal(searched, 'new query'); assert.ok(view.find({ label: 'Remote match' }))
  await view.unmount()
})
test('Mine and All preserve filtering and cache their separate pages', async () => {
  const tabs: string[] = []
  const view = await mount(panel, { host: mockHost({ requests: { ...requests, 'issues.list': input => { tabs.push(input.tab!); return requests['issues.list']() } } }) })
  await view.press({ label: 'Demo project' })
  await view.type({ label: 'Filter tasks' }, 'login', { replace: true })
  await view.press({ text: 'All' })
  assert.equal(view.valueOf({ label: 'Filter tasks' }), 'login')
  await view.press({ text: 'Mine' })
  assert.deepEqual(tabs, ['mine', 'all'])
  await view.unmount()
})
test('task details and comments stay inside the plugin; browser opens only from Open original', async () => {
  const host = mockHost({ requests })
  const view = await mount(panel, { host })
  await view.press({ label: 'Demo project' })
  await view.type({ label: 'Filter tasks' }, 'login', { replace: true })
  await view.press({ label: 'Fix login redirect' })
  assert.ok(view.find({ text: /Login redirects to the wrong page/ }))
  assert.ok(view.find({ text: 'Reproduced in the latest version.' }))
  assert.equal(host.callsOf('shell.openExternal').length, 0)
  await view.press({ label: 'Open original' })
  assert.equal(host.callsOf('shell.openExternal').length, 1)
  await view.press({ text: 'Back to issues' })
  assert.equal(view.valueOf({ label: 'Filter tasks' }), 'login')
  await view.unmount()
})
test('details preserve custom fields and semantic colors, and allow reading a subtask and returning without losing context', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { ...requests,
    'issues.detail': input => input.id === '44' ? { ...detail, id: '44', title: 'Check redirect target', description: 'Child task description', subtasks: 0, parent: { id: '42', title: 'Fix login redirect' } } : detail,
  } }) })
  await view.press({ label: 'Demo project' }); await view.press({ label: 'Fix login redirect' })
  assert.ok(view.find({ text: 'Priority' })); assert.ok(view.find({ text: 'Estimate' }))
  assert.equal(view.find({ type: 'Badge', text: 'High' })?.props.tone, 'danger')
  assert.equal(view.find({ type: 'Badge', text: 'In progress' })?.props.tone, 'accent')
  await view.press({ label: 'Check redirect target' })
  assert.ok(view.find({ text: 'Child task description' }))
  assert.ok(view.find({ text: '↳ Fix login redirect' }))
  await view.press({ text: 'Back' })
  assert.ok(view.find({ text: /Login redirects to the wrong page/ }))
  assert.ok(view.find({ label: 'Check redirect target' }))
  assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('disconnect clears the current list without touching the remote account', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { ...requests, 'connection.remove': () => ({ configured: false, url: '' }) } }) })
  await view.press({ label: 'Demo project' }); await view.press({ label: 'Connection settings' })
  await view.press({ text: 'Disconnect' })
  assert.equal(view.find({ label: 'Fix login redirect' }), null)
  assert.ok(view.find({ label: 'Personal access token' }))
  await view.unmount()
})
