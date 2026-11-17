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
  await assert.rejects(client('mantisbt', saved, async () => new Response('<html>Login</html>')).read('/users/me'), /valid API JSON/)
  await assert.rejects(client('mantisbt', saved, async () => { throw Error(saved.token) }).read('/users/me'), error => !error.message.includes(saved.token))
})
