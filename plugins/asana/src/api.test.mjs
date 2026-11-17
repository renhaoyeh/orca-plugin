import test from 'node:test'
import assert from 'node:assert/strict'
import { client, connection } from './api.mjs'
const saved = { token: 'test-only-token' }
test('validates tokens without persisting or reflecting them', () => {
  for (const token of ['', 'bad\r\nheader', 'with space']) assert.throws(() => connection('asana', { token }))
  assert.equal(connection('asana', saved).url, 'https://app.asana.com')
})
test('transport uses only GET, fixed Asana origin and manual redirects', async () => {
  let called = false
  const api = client('asana', saved, async (value, options) => {
    called = true
    assert.equal(new URL(value).origin, 'https://app.asana.com')
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual')
    assert.equal(options.headers.Authorization, 'Bearer ' + saved.token)
    return new Response('{"data":{"gid":"7"}}')
  })
  await api.read('/users/me')
  assert.equal(called, true)
  await assert.rejects(api.read('/../../../escape'), /Invalid/)
})
test('denied, rate-limited, redirects, network and malformed responses never leak server bodies or tokens', async () => {
  for (const status of [401, 403, 429, 302, 500]) {
    await assert.rejects(client('asana', saved, async () => new Response('secret=' + saved.token, { status })).read('/users/me'), error => !error.message.includes(saved.token) && !error.message.includes('secret='))
  }
  await assert.rejects(client('asana', saved, async () => new Response('<html>Login</html>')).read('/users/me'), /valid API JSON/)
  await assert.rejects(client('asana', saved, async () => { throw Error(saved.token) }).read('/users/me'), error => !error.message.includes(saved.token))
  await assert.rejects(client('asana', saved, async () => new Response('', { status: 404 })).read('/tasks/42'), error => error.status === 404)
})
