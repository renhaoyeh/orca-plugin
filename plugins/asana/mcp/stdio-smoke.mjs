import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startMcpBridge } from './bridge.mjs'

test('stdio MCP exposes one read-only live current-task tool', { timeout: 15000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'asana-bridge-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const directory = join(home, '.orca-asana-mcp')
  const task = { id: '42', title: 'Fixture task', description: 'Notes', url: 'https://app.asana.com/0/1/42', comments: [{ author: 'Tester', at: 'now', text: 'C'.repeat(1001) }], commentsError: 'Some comments failed.', truncated: false }
  let selected = task
  const close = await startMcpBridge(async caller => {
    assert.equal(caller.workspaceId, 'workspace-test')
    return selected
  }, directory)
  t.after(close)
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
  const [{ args }] = manifest.contributes.mcpServers
  const transport = new StdioClientTransport({ command: process.execPath, args, env: { HOME: home, USERPROFILE: home, ASANA_ORCA_WORKSPACE_ID: 'workspace-test' } })
  const client = new Client({ name: 'asana-mcp-test', version: '1' })
  t.after(() => client.close())
  await client.connect(transport)
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(tool => tool.name), ['get_current_task'])
  assert.equal(tools[0].annotations.readOnlyHint, true)
  const read = async () => JSON.parse((await client.callTool({ name: 'get_current_task', arguments: {} })).content[0].text)
  const result = await read()
  assert.equal(result.task.id, task.id)
  assert.equal(result.task.comments[0].text.length, 1000)
  assert.equal(result.task.commentsError, task.commentsError)
  assert.equal(result.task.truncated, true)
  selected = { ...task, id: '43', title: 'After navigation' }
  assert.equal((await read()).task.id, '43')
  selected = null
  assert.deepEqual(await read(), { task: null })
})
