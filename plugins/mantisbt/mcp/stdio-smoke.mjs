import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mantisClient } from '../src/mantis-client.mjs'
import { startMcpBridge } from './bridge.mjs'

test('Orca launch command reads live sidebar state through the authenticated MCP bridge', { timeout: 15_000 }, async t => {
  const token = 'local-fixture-token'
  const issue = { id: 42, summary: 'Login redirect', project: { id: 12, name: 'Demo' },
    status: { id: 80, name: 'resolved' }, description: 'Redirect target is wrong.',
    notes: [{ id: 1, text: 'Updated', reporter: { name: 'Tester' } }] }
  const requests = []
  const fixture = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    requests.push({ method: request.method, path: url.pathname, query: url.searchParams, auth: request.headers.authorization })
    response.setHeader('content-type', 'application/json')
    const fixtures = {
      '/api/rest/projects': { projects: [{ id: 12, name: 'Demo', subprojects: [{ id: 13, name: 'Product' }] }] },
      '/api/rest/config': { configs: [{ option: 'bug_resolved_status_threshold', value: 80 }] },
      '/api/rest/issues': { issues: Array.from({ length: 20 }, (_, i) => ({ ...issue, id: i + 40 })) },
      '/api/rest/issues/42': { issues: [issue] },
    }
    if (!fixtures[url.pathname]) response.statusCode = 404
    response.end(JSON.stringify(fixtures[url.pathname] ?? { error: token }))
  })
  await new Promise((resolve, reject) => fixture.listen(0, '127.0.0.1', resolve).once('error', reject))
  t.after(() => new Promise(resolve => fixture.close(resolve)))
  const home = await mkdtemp(join(tmpdir(), 'mantisbt-bridge-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const directory = join(home, '.orca-mantisbt-mcp')
  const mantis = mantisClient('mantisbt', { url: `http://127.0.0.1:${fixture.address().port}`, token })
  let selected = null
  const close = await startMcpBridge(() => mantis, async caller => {
    assert.equal(resolve(caller.cwd), process.cwd())
    assert.equal(caller.workspaceId, 'workspace-test')
    return selected
  }, directory)
  t.after(close)
  const descriptor = JSON.parse(await readFile(join(directory, 'bridge.json'), 'utf8'))
  const rejected = connect(descriptor.port, '127.0.0.1')
  const closed = once(rejected, 'close')
  const unexpected = []
  rejected.on('data', data => unexpected.push(data))
  rejected.write(JSON.stringify({ key: '0'.repeat(64), cwd: process.cwd() }) + '\n')
  await closed
  assert.deepEqual(unexpected, [])
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
  const [{ args }] = manifest.contributes.mcpServers
  const transport = new StdioClientTransport({
    command: process.execPath, args,
    env: { HOME: home, USERPROFILE: home, MANTISBT_ORCA_WORKSPACE_ID: 'workspace-test' },
  })
  const client = new Client({ name: 'mantisbt-mcp-test', version: '1' })
  t.after(() => client.close())
  await client.connect(transport)
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(tool => tool.name), ['get_current_issue', 'list_projects', 'list_issues', 'get_issue'])
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint))

  async function read(name, args) {
    const result = await client.callTool({ name, arguments: args })
    assert.ok(!result.isError, result.content[0].text)
    return JSON.parse(result.content[0].text)
  }
  assert.deepEqual((await read('list_projects', { query: 'Demo Product' })).projects,
    [{ id: '13', name: 'Product', parent: 'Demo' }])
  assert.deepEqual(await read('list_issues', { project_id: 12, assigned_to_me: true }),
    { issues: [], next_page: 2 })
  const page = await read('list_issues', { project_id: '12', page: 2, include_resolved: true })
  assert.equal(page.issues[0].resolved, true)
  assert.equal(requests.find(item => item.query.get('filter_id') === 'assigned').query.get('page'), '1')
  assert.ok(requests.some(item => item.query.get('page') === '2'))
  const detail = await read('get_issue', { issue_id: 42 })
  assert.equal(detail.description, issue.description)
  assert.equal(detail.comments[0].text, 'Updated')
  assert.deepEqual((await read('get_issue', { issue_id: 42, comment_limit: 0 })).comments, [])
  assert.deepEqual(await read('get_current_issue', {}), { issue: null })
  selected = detail
  assert.equal((await read('get_current_issue', {})).issue.id, '42')
  selected = { ...detail, id: '43' }
  assert.equal((await read('get_current_issue', {})).issue.id, '43')
  selected = null
  assert.deepEqual(await read('get_current_issue', {}), { issue: null })
  const missing = await client.callTool({ name: 'get_issue', arguments: { issue_id: 999 } })
  assert.equal(missing.isError, true)
  assert.doesNotMatch(missing.content[0].text, /local-fixture-token/)
  const count = requests.length
  const invalid = await client.callTool({ name: 'get_issue', arguments: { issue_id: '../42' } })
  assert.equal(invalid.isError, true)
  assert.equal(requests.length, count)
  assert.ok(requests.every(item => item.method === 'GET' && item.auth === token))
})
