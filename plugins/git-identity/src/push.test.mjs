import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readIdentity, gitEnvironment } from './git.mjs'
import { credentialConfig, readPushBinding, savePushBinding } from './push.mjs'
const execute = promisify(execFile)
const account = { host: 'github.com', login: 'demo-account' }
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'orca-gh-binding-')), repo = join(root, 'repo'), global = join(root, 'global')
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: global }
  const git = async args => (await execute('git', ['-C', repo, ...args], { env: gitEnvironment(env), windowsHide: true })).stdout.trim()
  try {
    await mkdir(repo); await writeFile(global, '[user]\n name = Demo\n email = demo@example.test\n')
    await git(['init'])
    await run({ repo, env, git, global })
  } finally { await rm(root, { recursive: true, force: true }) }
}
test('repo binding matches herdr-zed routing, switches locally, and removal restores previous settings', () => fixture(async ({ repo, env, git, global }) => {
  await git(['remote', 'add', 'origin', 'git@github.com:demo/repo.git'])
  await git(['config', '--local', '--add', 'credential.https://github.com.helper', 'previous-helper'])
  await git(['config', '--local', '--add', 'url.https://github.com/.insteadOf', 'old-prefix:'])
  const globalBefore = await readFile(global, 'utf8')
  const initial = await readIdentity(repo, { env })
  await savePushBinding(repo, { ...initial, account }, { env })
  assert.deepEqual(await readPushBinding(repo, { env }), { ...account, managed: true })
  assert.equal(await git(['remote', 'get-url', 'origin']), 'https://github.com/demo/repo.git')
  assert.equal(await git(['config', '--local', 'remote.origin.url']), 'git@github.com:demo/repo.git')
  const helper = await git(['config', '--local', '--get-all', 'credential.https://github.com.helper'])
  assert.ok(helper.includes("gh auth token --hostname 'github.com' --user 'demo-account'"))
  assert.ok(helper.includes('unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN'))
  const bound = await readIdentity(repo, { env })
  await savePushBinding(repo, { ...bound, account: { ...account, login: 'work-account' } }, { env })
  assert.equal((await readPushBinding(repo, { env })).login, 'work-account')
  const switched = await readIdentity(repo, { env })
  await savePushBinding(repo, { ...switched, account: null }, { env })
  assert.equal(await readPushBinding(repo, { env }), null)
  assert.equal(await git(['config', '--local', '--get-all', 'credential.https://github.com.helper']), 'previous-helper')
  assert.equal(await git(['config', '--local', '--get-all', 'url.https://github.com/.insteadOf']), 'old-prefix:')
  assert.equal(await git(['remote', 'get-url', 'origin']), 'git@github.com:demo/repo.git')
  assert.equal((await readIdentity(repo, { env })).name, initial.name)
  assert.equal(await readFile(global, 'utf8'), globalBefore)
}))
test('credential helper routes only matching HTTPS get requests and fails closed when gh cannot supply credentials', async () => {
  const shell = process.platform === 'win32' ? join((await execute('git', ['--exec-path'])).stdout.trim(), '../../../bin/sh.exe') : 'sh'
  const body = credentialConfig(account)[0].values[1].slice(1, -3)
  const mock = `gh() { [ "$*" = 'auth token --hostname github.com --user demo-account' ] || return 1; [ -z "$GH_TOKEN$GITHUB_TOKEN$GH_ENTERPRISE_TOKEN$GITHUB_ENTERPRISE_TOKEN" ] || return 1; printf 'test-only-password'; }; `
  const run = (request, operation = 'get', implementation = mock) => execute(shell, ['-c', implementation + body + `; printf '%s' '${request}' | f ${operation}`], { env: { ...process.env, GH_TOKEN: 'ignored-test-value' }, windowsHide: true })
  assert.equal((await run('protocol=https\nhost=github.com\n\n')).stdout, 'username=demo-account\npassword=test-only-password\n')
  assert.equal((await run('protocol=https\nhost=other.example\n\n')).stdout, '')
  assert.equal((await run('protocol=http\nhost=github.com\n\n')).stdout, '')
  assert.equal((await run('protocol=https\nhost=github.com\n\n', 'store')).stdout, '')
  await assert.rejects(run('protocol=https\nhost=github.com\n\n', 'get', 'gh() { return 1; }; '), error => error.code === 1 && error.stdout === 'quit=true\n')
})

test('externally edited helpers are detected and never overwritten or removed', () => fixture(async ({ repo, env, git }) => {
  const initial = await readIdentity(repo, { env })
  await savePushBinding(repo, { ...initial, account }, { env })
  await git(['config', '--local', '--replace-all', 'credential.https://github.com.helper', 'external-helper'])
  assert.equal((await readPushBinding(repo, { env })).managed, false)
  const changed = await readIdentity(repo, { env }), before = await readFile(changed.configPath, 'utf8')
  await assert.rejects(savePushBinding(repo, { ...changed, account: null }, { env }), /edited outside/)
  assert.equal(await readFile(changed.configPath, 'utf8'), before)
}))
test('failed binding is atomic, invalid accounts cannot inject shell text, no gh command runs on save', () => fixture(async ({ repo, env }) => {
  const initial = await readIdentity(repo, { env }), before = await readFile(initial.configPath, 'utf8')
  assert.throws(() => credentialConfig({ host: 'github.com', login: "bad'; cmd" }), /Invalid/)
  await assert.rejects(savePushBinding(repo, { ...initial, account }, { env, beforeCommit: () => { throw Error('Workspace changed') } }), /Workspace changed/)
  assert.equal(await readFile(initial.configPath, 'utf8'), before)
  await savePushBinding(repo, { ...initial, account }, { env, execute: async (bin, args, options) => {
    assert.equal(bin, 'git') // no token retrieval, gh switch, push or network operation
    assert.ok(!args.includes('push'))
    return execute(bin, args, options)
  } })
}))
