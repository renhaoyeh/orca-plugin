import test from 'node:test'
import assert from 'node:assert/strict'
import { listAllAccounts, parseAccounts, claudeCommand, createLoginTerminal } from './accounts.mjs'

const id = '22222222-2222-2222-2222-222222222222'
const runtime = { root: 'C:\\Orca', cli: "C:\\Orca's tools\\orca.exe" }
const decode = command => Buffer.from(command.split(' ').at(-1), 'base64').toString('utf16le')

test('discovers both providers and checks Claude credentials without reading them', async () => {
  const calls = [], checked = []
  const accounts = await listAllAccounts({ runtime,
    execute: async (_, args) => {
      calls.push(args)
      const provider = args[3]
      return { stdout: JSON.stringify({ ok: true, result: { accounts: [{ id: provider === 'claude' ? id : '11111111-1111-1111-1111-111111111111', email: `${provider}@example.test`, home: 'C:\\Claude Work' }] } }) }
    }, access: async path => { checked.push(path) },
  })
  assert.equal(calls.length, 2)
  assert.equal(accounts[1].provider, 'claude')
  assert.equal(accounts[1].home, 'C:\\Claude Work')
  assert.ok(checked.includes('C:\\Claude Work\\.credentials.json'))
  const invalid = parseAccounts({ ok: true, result: { accounts: [{ id, home: 'relative' }] } }, runtime.root, 'claude')
  assert.equal(invalid[0].home, '')
})

test('Claude command isolates config, clears inherited API routing and bypasses shell wrappers', () => {
  const script = decode(claudeCommand("C:\\Claude's $() & home"))
  assert.ok(script.includes("$env:CLAUDE_CONFIG_DIR = 'C:\\Claude''s $() & home'"))
  assert.ok(script.includes('Env:ANTHROPIC_API_KEY'))
  assert.ok(script.includes('Env:CLAUDE_CODE_OAUTH_TOKEN'))
  assert.ok(script.includes('Get-Command claude.exe -CommandType Application'))
  assert.ok(script.includes('.credentials.json'))
  assert.throws(() => claudeCommand('relative'))
  assert.throws(() => claudeCommand('C:\\bad\npath'))
})

test('add account opens the official login CLI only in an explicitly requested terminal', async () => {
  for (const provider of ['codex', 'claude']) {
    let args
    const result = await createLoginTerminal('w', provider, { runtime, execute: async (_, input) => {
      args = input
      return { stdout: JSON.stringify({ ok: true, result: { terminal: { handle: 'login', orphaned: false } } }) }
    } })
    assert.deepEqual(result, { terminalId: 'login' })
    const script = decode(args[args.indexOf('--command') + 1])
    assert.ok(script.includes(`account add --agent ${provider}`))
    assert.ok(script.includes("& 'C:\\Orca''s tools\\orca.exe'"))
    assert.ok(args.includes('--focus'))
    assert.equal(args[args.indexOf('--title') + 1], `${provider === 'claude' ? 'Claude' : 'Codex'} · Sign in`)
  }
  await assert.rejects(createLoginTerminal('w', 'bad;command', { runtime }))
})
