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
  const task = {
    id: '42', title: 'Fixture task', description: 'Notes', url: 'https://app.asana.com/0/1/42',
    comments: Array.from({ length: 35 }, (_, index) => ({ id: String(index + 1), author: 'Tester', at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), text: index === 34 ? 'C'.repeat(1001) : `Comment ${index + 1}` })),
    activities: Array.from({ length: 15 }, (_, index) => ({
      id: `activity-${index + 1}`, subtype: index === 7 ? 'section_changed' : 'due_date_changed', author: 'Actor',
      at: new Date(Date.UTC(2026, 1, index + 1)).toISOString(), text: index === 7 ? '' : index === 14 ? 'A'.repeat(1001) : `Activity ${index + 1}`,
      fallback: index === 7 ? 'Section Changed' : 'Due Date Changed',
    })),
    commentsError: 'Some comments failed.', activitiesError: 'Some activities failed.', truncated: true,
  }
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
  assert.deepEqual(result.task.comments.map(comment => comment.at), ['2026-01-31T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z', '2026-02-03T00:00:00.000Z', '2026-02-04T00:00:00.000Z'])
  assert.equal(result.task.comments.at(-1).text.length, 1000)
  assert.deepEqual(result.task.activities.map(activity => activity.id), ['activity-6', 'activity-7', 'activity-8', 'activity-9', 'activity-10', 'activity-11', 'activity-12', 'activity-13', 'activity-14', 'activity-15'])
  assert.equal(result.task.activities.at(-1).text.length, 1000)
  assert.equal(result.task.activities.find(activity => activity.id === 'activity-8').text, 'Section Changed')
  assert.ok(result.task.activities.every(activity => activity.subtype !== 'comment_added'))
  assert.equal(result.task.commentsTruncated, true)
  assert.equal(result.task.activitiesTruncated, true)
  assert.equal(result.task.commentsError, task.commentsError)
  assert.equal(result.task.activitiesError, task.activitiesError)
  assert.equal(result.task.truncated, true)
  selected = { ...task, id: '43', title: 'After navigation' }
  assert.equal((await read()).task.id, '43')
  selected = null
  assert.deepEqual(await read(), { task: null })
})
