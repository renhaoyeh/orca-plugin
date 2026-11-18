import test from 'node:test'
import assert from 'node:assert/strict'
import { client, connection, normalizeServer } from './api.mjs'
const saved = { url: 'https://mantis.example.test', token: 'test-only-token' }
const response = body => new Response(JSON.stringify(body))
test('normalizes Mantis API roots and rejects credential URLs, query secrets and invalid tokens', () => {
  assert.equal(normalizeServer('https://mantis.example.test/path/api/rest/index.php/'), 'https://mantis.example.test/path')
  for (const url of ['file:///secret', 'https://user:pass@example.test', 'https://example.test?token=secret']) assert.throws(() => normalizeServer(url))
  assert.throws(() => connection('mantisbt', { ...saved, token: 'bad\r\nheader' }))
})
test('Mantis GET transport negotiates bare/Bearer auth, blocks escaped paths and never follows redirects', async () => {
  const calls = []
  const api = client('mantisbt', saved, async (url, options) => {
    calls.push({ url, ...options })
    return calls.length === 1 ? new Response('', { status: 401 }) : response({ issues: [] })
  })
  await api.read('/issues', { project_id: '12' })
  assert.equal(calls.length, 2); assert.equal(calls[0].headers.Authorization, saved.token)
  assert.equal(calls[1].headers.Authorization, 'Bearer ' + saved.token)
  assert.ok(calls.every(call => call.method === 'GET' && call.redirect === 'manual'))
  assert.equal(new URL(calls[1].url).searchParams.get('project_id'), '12')
  await assert.rejects(api.read('/../../secret'), /Invalid/)
})
test('errors never reflect server bodies or tokens; 404 metadata supports original deleted-issue handling', async () => {
  for (const status of [401, 403, 429, 302, 500, 404]) {
    await assert.rejects(client('mantisbt', saved, async () => new Response('secret=' + saved.token, { status })).read('/users/me'), error => !error.message.includes(saved.token) && !error.message.includes('secret=') && (status !== 404 || error.status === 404))
  }
  await assert.rejects(client('mantisbt', saved, async () => { throw Error(saved.token) }).read('/users/me'), error => !error.message.includes(saved.token))
})

test('accepts large project lists while bounding both project and non-project responses', async () => {
  const projects = [{ id: 1, name: 'Project', description: 'x'.repeat(4 * 1024 * 1024) }]
  const api = client('mantisbt', saved, async () => response({ projects }))
  assert.deepEqual((await api.read('/projects')).projects, projects)
  await assert.rejects(api.read('/projects/1'), /exceeded 4 MiB/)

  const chunk = new Uint8Array(1024 * 1024).fill(32)
  let cancelled = false
  const oversized = client('mantisbt', saved, async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(chunk) },
    cancel() { cancelled = true }
  })))
  await assert.rejects(oversized.read('/projects'), /exceeded 32 MiB/)
  assert.equal(cancelled, true)
})

test('distinguishes unreadable, empty, HTML and malformed API responses without exposing content', async () => {
  const cases = [
    [new Response(new ReadableStream({ start(controller) { controller.error(Error(saved.token)) } })), /finish reading/],
    [new Response(null), /empty response/],
    [new Response('  '), /empty response/],
    [new Response(' <html>' + saved.token), /returned HTML/],
    [new Response('{"value":' + saved.token), /valid API JSON/],
    [response([]), /unexpected JSON/]
  ]
  for (const [result, message] of cases) {
    const api = client('mantisbt', saved, async () => result)
    await assert.rejects(api.read('/users/me'), error => message.test(error.message) && !error.message.includes(saved.token))
  }
})
