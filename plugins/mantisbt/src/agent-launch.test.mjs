import { assert, test } from 'orca/testing'
import { installedAgents, launchAgent } from './agent-launch.mjs'

test('Agent handoff uses dynamically installed choices and the exact workspace id', async () => {
  const calls = []
  const agents = await installedAgents(async args => { calls.push(args); return { agents: [{ id: 'codex', name: 'Codex', default: true }] } }, 'ws-123')
  assert.deepEqual(agents, [{ id: 'codex', name: 'Codex', default: true }])
  assert.deepEqual(calls[0], ['agent', 'installed', '--worktree', 'id:ws-123', '--json'])
})

test('Agent launch is a single explicit CLI invocation pinned to the workspace', async () => {
  const calls = []
  const result = await launchAgent(async args => { calls.push(args); return {} }, 'identity:wt2:local:example', 'codex', 'Reviewed prompt')
  assert.deepEqual(result, { started: true })
  assert.deepEqual(calls[0], ['agent', 'launch', '--agent', 'codex', '--worktree', 'identity:wt2:local:example', '--prompt', 'Reviewed prompt', '--focus', '--json'])
})

test('oversized prompts are rejected before invoking Orca', async () => {
  let calls = 0
  await assert.rejects(launchAgent(async () => { calls++; return {} }, 'ws-123', 'codex', 'x'.repeat(7001)), /too long/)
  assert.equal(calls, 0)
})
