import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { claudeCommand } from './accounts.mjs'

test('Claude PowerShell uses only a fake CLI, isolates config and removes inherited API keys', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-claude-test-'))
  const home = join(root, "Claude '$() & space"), bin = join(root, 'bin')
  const before = process.env.CLAUDE_CONFIG_DIR
  try {
    await mkdir(home); await mkdir(bin)
    await writeFile(join(home, '.credentials.json'), '{}')
    await writeFile(join(bin, 'claude.cmd'), '@echo off\r\necho "STUB-HOME=%CLAUDE_CONFIG_DIR%"\r\necho "STUB-KEY=%ANTHROPIC_API_KEY%"\r\necho "STUB-CWD=%CD%"\r\n')
    const encoded = claudeCommand(home).split(' ').at(-1)
    const shell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const options = { cwd: root, windowsHide: true, timeout: 15000, env: { ...process.env, ANTHROPIC_API_KEY: 'fake-not-a-real-key', PATH: `${bin};${join(process.env.SystemRoot, 'System32')}` } }
    const { stdout } = await promisify(execFile)(shell, ['-NoProfile', '-EncodedCommand', encoded], options)
    assert.ok(stdout.includes(`STUB-HOME=${home}`), stdout)
    assert.ok(stdout.includes(`STUB-CWD=${root}`), stdout)
    assert.equal(stdout.includes('fake-not-a-real-key'), false)
    assert.equal(process.env.CLAUDE_CONFIG_DIR, before)
    await rm(join(home, '.credentials.json'))
    await assert.rejects(promisify(execFile)(shell, ['-NoProfile', '-EncodedCommand', encoded], options))
  } finally { await rm(root, { recursive: true, force: true }) }
})
