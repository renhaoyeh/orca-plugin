import test from 'node:test'
import assert from 'node:assert/strict'
import { createConnection } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newApiProfile, parseApiProfiles, openKeyPipe, createApiTerminal } from './api-profiles.mjs'
import { terminalCommand } from './accounts.mjs'

const fakeKey = 'sk-test-not-a-real-key'
const profile = { id: 'api-11111111-1111-1111-1111-111111111111', name: 'Paid API' }

test('validates profiles and keeps credentials out of metadata', () => {
  const item = newApiProfile(' API ', fakeKey)
  assert.match(item.id, /^api-/)
  assert.deepEqual(Object.keys(item).sort(), ['id', 'name'])
  assert.deepEqual(parseApiProfiles([{ ...item, key: fakeKey }]), [item])
  assert.throws(() => newApiProfile('', fakeKey))
  assert.throws(() => newApiProfile('API', 'bad\nkey'))
  assert.throws(() => parseApiProfiles([{ id: '../escape', name: 'Bad' }]))
  assert.throws(() => parseApiProfiles([item, item]))
})

test('API launch uses an isolated home and a pipe name, never a key in the command', async () => {
  let call
  let closed = false
  const options = {
    runtime: { root: 'C:\\Orca', cli: 'C:\\orca.exe' }, mkdir: async () => {},
    openKeyPipe: async key => { assert.equal(key, fakeKey); return { name: 'orca-codex-api-' + 'a'.repeat(64), close: () => { closed = true } } },
    createTerminal: async (...args) => { call = args; return { terminalId: 't' } },
  }
  assert.deepEqual(await createApiTerminal('workspace', profile, fakeKey, options), { terminalId: 't' })
  assert.match(call[1].home, /codex-accounts-plugin\\api-homes\\api-/)
  assert.equal(JSON.stringify(call).includes(fakeKey), false)
  const script = Buffer.from(call[2].command.split(' ').at(-1), 'base64').toString('utf16le')
  assert.ok(script.includes('https://api.openai.com/v1'))
  assert.ok(script.includes('requires_openai_auth=false'))
  assert.equal(script.includes('auth.json'), false)
  await assert.rejects(createApiTerminal('w', profile, fakeKey, { ...options, createTerminal: async () => { throw Error(fakeKey) } }), error => !error.message.includes(fakeKey))
  assert.equal(closed, true)
})

test('credential pipe is one-use and transfers only over a local named pipe', { skip: process.platform !== 'win32' }, async () => {
  const pipe = await openKeyPipe(fakeKey)
  try {
    const data = await new Promise((resolve, reject) => {
      let data = ''
      const socket = createConnection(pipe.address)
      socket.on('data', part => { data += part })
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    assert.equal(JSON.parse(data).key, fakeKey)
    await assert.rejects(new Promise((resolve, reject) => {
      const socket = createConnection(pipe.address)
      socket.on('connect', () => { socket.destroy(); resolve('Pipe was reusable') })
      socket.on('error', reject)
    }))
  } finally { pipe.close() }
})

test('PowerShell receives a fake API key without login and launches only a stub CLI', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-api-test-'))
  const pipe = await openKeyPipe(fakeKey)
  try {
    const bin = join(root, 'bin')
    await mkdir(bin)
    await writeFile(join(bin, 'codex.cmd'), '@echo off\r\necho "API-KEY=%OPENAI_API_KEY%"\r\necho "API-HOME=%CODEX_HOME%"\r\n')
    const command = terminalCommand(root, { pipeName: pipe.name })
    const shell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const { stdout } = await promisify(execFile)(shell, ['-NoProfile', '-EncodedCommand', command.split(' ').at(-1)], {
      windowsHide: true, timeout: 15000, cwd: root,
      env: { ...process.env, PATH: `${bin};${join(process.env.SystemRoot, 'System32')}` },
    })
    assert.ok(stdout.includes(`API-KEY=${fakeKey}`))
    assert.ok(stdout.includes(`API-HOME=${root}`))
  } finally { pipe.close(); await rm(root, { recursive: true, force: true }) }
})
