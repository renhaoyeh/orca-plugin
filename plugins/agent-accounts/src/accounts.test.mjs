import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseAccounts, listAccounts, terminalCommand, runtime, createTerminal, localCliEnv } from './accounts.mjs'

const id = '11111111-1111-1111-1111-111111111111'
const body = { ok: true, result: { accounts: [{ id, email: 'demo@example.test', managedHomeRuntime: 'host' }] } }

test('uses Orca account display names by default, leaving scheme labels intact', () => {
  const named = { ok: true, result: { accounts: [{ id, email: 'demo@example.test', displayName: 'Personal (Pro 100)', workspaceLabel: 'Personal' }] } }
  assert.equal(parseAccounts(named, 'C:\\Orca')[0].label, 'Personal (Pro 100)')
  named.result.accounts[0].displayName = ' '
  assert.equal(parseAccounts(named, 'C:\\Orca')[0].label, 'demo@example.test · Personal')
})

test('local CLI omits environment selectors instead of requesting a saved environment named local', () => {
  const env = localCliEnv('C:\\Orca', { ORCA_ENVIRONMENT: 'local', orca_pairing_code: 'secret', ORCA_REMOTE_PAIRING: 'remote', ORCA_USER_DATA_PATH: 'old', PATH: 'keep' })
  assert.deepEqual(env, { PATH: 'keep', ORCA_USER_DATA_PATH: 'C:\\Orca' })
})

test('creates a visible terminal tab and focuses it after the user clicks launch', async () => {
  let call
  const options = { runtime: { root: 'C:\\Orca', cli: 'C:\\orca.exe' }, execute: async (...args) => {
    call = args
    return { stdout: JSON.stringify({ ok: true, result: { terminal: { handle: 't', orphaned: false } } }) }
  } }
  assert.deepEqual(await createTerminal('identity:demo', { home: 'C:\\account', label: 'Work & stuff' }, options), { terminalId: 't' })
  assert.deepEqual(call[1].slice(0, 8), ['terminal', 'create', '--worktree', 'identity:demo', '--shell', 'powershell.exe', '--title', 'Codex · Work & stuff'])
  assert.equal(call[1].includes('--focus'), true)
  assert.equal(call[1].includes('--background'), false)
  assert.equal(call[2].env.ORCA_USER_DATA_PATH, 'C:\\Orca')
  assert.equal('ORCA_ENVIRONMENT' in call[2].env, false)
  await assert.rejects(createTerminal('w', { home: 'C:\\account', label: 'Work' }, { ...options, execute: async () => ({ stdout: JSON.stringify({ ok: true, result: { terminal: { handle: 't', orphaned: true } } }) }) }), /background/)
})

test('launch failure shows the Orca error instead of the entire encoded command', async () => {
  await assert.rejects(createTerminal('w', { home: 'C:\\account', label: 'Work' }, {
    runtime: { root: 'C:\\Orca', cli: 'C:\\orca.exe' },
    execute: async () => { throw { code: 1, message: 'Command failed: huge encoded command', stdout: JSON.stringify({ error: { code: 'invalid_params', message: 'Actual launch error' } }) } },
  }), { message: 'invalid_params: Actual launch error' })
})

test('account discovery only calls the read-only local CLI and checks auth existence', async () => {
  let call
  let checked
  const accounts = await listAccounts({
    runtime: { root: 'C:\\Orca Data', cli: 'C:\\Orca\\orca.exe' },
    execute: async (...args) => { call = args; return { stdout: JSON.stringify(body) } },
    access: async path => { checked = path },
  })
  assert.equal(call[0], 'C:\\Orca\\orca.exe')
  assert.deepEqual(call[1], ['account', 'list', '--agent', 'codex', '--json'])
  assert.equal('ORCA_ENVIRONMENT' in call[2].env, false)
  assert.equal(call[2].env.ORCA_USER_DATA_PATH, 'C:\\Orca Data')
  assert.equal(call[2].windowsHide, true)
  assert.equal(checked, `C:\\Orca Data\\codex-accounts\\${id}\\home\\auth.json`)
  assert.equal(accounts[0].disabledReason, '')
})

test('rejects invalid ids and malformed CLI responses, disables WSL and missing auth', async () => {
  assert.throws(() => parseAccounts({ ok: false }, 'C:\\Orca'))
  assert.throws(() => parseAccounts({ ok: true, result: { accounts: [{ id: '..\\escape' }] } }, 'C:\\Orca'))
  const wsl = structuredClone(body)
  wsl.result.accounts[0].managedHomeRuntime = 'wsl'
  assert.match(parseAccounts(wsl, 'C:\\Orca')[0].disabledReason, /WSL/)
  const accounts = await listAccounts({
    runtime: { root: 'C:\\Orca', cli: 'C:\\orca.exe' },
    execute: async () => ({ stdout: JSON.stringify(body) }),
    access: async () => { throw Error('missing') },
  })
  assert.match(accounts[0].disabledReason, /Sign-in/)
  await assert.rejects(listAccounts({ runtime: { root: 'C:\\Orca', cli: 'C:\\orca.exe' }, execute: async () => ({ stdout: 'broken' }) }), /parse/)
})

test('uses the current Orca data root and rejects unsupported environments', () => {
  assert.deepEqual(runtime({ ORCA_USER_DATA_PATH: 'C:\\Dev Orca', ORCA_CLI_COMMAND: 'C:\\Dev\\orca.exe' }, 'win32'), { root: 'C:\\Dev Orca', cli: 'C:\\Dev\\orca.exe' })
  assert.throws(() => runtime({}, 'linux'), /Windows/)
  assert.match(runtime({}, 'win32').cli, /AppData\\Local\\Programs\\orca\\resources\\bin\\orca\.exe$/)
  assert.throws(() => terminalCommand('relative'))
  assert.throws(() => terminalCommand('C:\\bad\npath'))
})

test('reports CLI connection failures without leaking raw output', async () => {
  await assert.rejects(listAccounts({
    runtime: { root: 'C:\\Orca', cli: 'C:\\orca.exe' },
    execute: async () => { throw { stdout: JSON.stringify({ error: { message: 'Runtime unavailable' } }), stderr: 'private output' } },
  }), { message: 'Runtime unavailable' })
})

test('PowerShell launches only a stub CLI with the selected home, preserves cwd and parent env, and quotes metacharacters', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-account-test-'))
  const home = join(root, "account '$() & space")
  const bin = join(root, 'bin')
  const before = process.env.CODEX_HOME
  try {
    await mkdir(home)
    await mkdir(bin)
    await writeFile(join(home, 'auth.json'), '{}')
    await writeFile(join(bin, 'codex.cmd'), '@echo off\r\necho "STUB-HOME=%CODEX_HOME%"\r\necho "STUB-CWD=%CD%"\r\n')
    const command = terminalCommand(home)
    assert.match(command, /^powershell\.exe -NoLogo -NoProfile -NoExit -EncodedCommand [A-Za-z0-9+/=]+$/)
    const encoded = command.split(' ').at(-1)
    const shell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const { stdout } = await promisify(execFile)(shell, ['-NoLogo', '-NoProfile', '-EncodedCommand', encoded], {
      cwd: root, windowsHide: true, timeout: 15000,
      env: { ...process.env, PATH: `${bin};${join(process.env.SystemRoot, 'System32')}` },
    })
    assert.ok(stdout.includes(`STUB-HOME=${home}`), stdout)
    assert.ok(stdout.includes(`STUB-CWD=${root}`), stdout)
    assert.equal(process.env.CODEX_HOME, before)
    await rm(join(home, 'auth.json'))
    await assert.rejects(promisify(execFile)(shell, ['-NoProfile', '-EncodedCommand', encoded], {
      cwd: root, windowsHide: true, timeout: 15000,
      env: { ...process.env, PATH: `${bin};${join(process.env.SystemRoot, 'System32')}` },
    }))
  } finally { await rm(root, { recursive: true, force: true }) }
})
