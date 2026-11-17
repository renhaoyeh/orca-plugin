import test from 'node:test'
import assert from 'node:assert/strict'
import { launchPi } from './pi.mjs'

const runtime = { cli: 'C:\\Orca\\orca.exe', root: 'C:\\Orca Data' }

test('Pi uses Orca agent launch with explicit Chat UI, workspace and no prompt or credentials', async () => {
  let call
  const result = await launchPi('identity:demo', { runtime, execute: async (...args) => {
    call = args
    return { stdout: JSON.stringify({ ok: true, result: { outcome: { kind: 'structured', handle: 'chat-demo' } } }) }
  } })
  assert.deepEqual(result, { accepted: true })
  assert.equal(call[0], runtime.cli)
  assert.deepEqual(call[1], ['agent', 'launch', '--agent', 'pi', '--worktree', 'identity:demo', '--surface', 'chat', '--focus', '--json'])
  assert.equal(call[2].env.ORCA_USER_DATA_PATH, runtime.root)
  assert.equal('ORCA_ENVIRONMENT' in call[2].env, false)
  assert.equal(call[1].includes('--approve'), false)
})

test('Pi accepts a structured chat receipt nested in a launch result', async () => {
  assert.deepEqual(await launchPi('w', { runtime, execute: async () => ({
    stdout: JSON.stringify({ ok: true, result: { launch: { outcome: { kind: 'structured', handle: 'chat' } } } }),
  }) }), { accepted: true })
})

test('Pi reports CLI fallback or missing Chat confirmation without launching again', async () => {
  for (const [result, pattern] of [
    [{ outcome: { kind: 'terminal', handle: 'existing-terminal' } }, /CLI terminal instead of Chat/],
    [{}, /Pi Chat launch could not be confirmed/],
  ]) {
    let calls = 0
    await assert.rejects(launchPi('w', { runtime, execute: async () => {
      calls++
      return { stdout: JSON.stringify({ ok: true, result }) }
    } }), pattern)
    assert.equal(calls, 1)
  }
})

test('Pi launch errors are not retried and do not expose raw output', async () => {
  let calls = 0
  const options = { runtime, execute: async () => {
    calls++
    throw { stdout: JSON.stringify({ error: { message: 'Pi CLI not installed' } }), stderr: 'private output', message: 'raw command' }
  } }
  await assert.rejects(launchPi('w', options), { message: 'Pi CLI not installed' })
  assert.equal(calls, 1)
  await assert.rejects(launchPi('w', { runtime, execute: async () => ({ stdout: 'broken private output' }) }), /Check existing tabs/)
  await assert.rejects(launchPi('w', { runtime, execute: async () => ({ stdout: '{"ok":false}' }) }), /Check existing tabs/)
  await assert.rejects(launchPi('', options), /workspace/)
  assert.equal(calls, 1)
})
