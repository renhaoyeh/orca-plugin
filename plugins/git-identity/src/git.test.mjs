import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readIdentity, saveIdentity, validateAuthor, gitEnvironment } from './git.mjs'
const execute = promisify(execFile)
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'orca-git-identity-')), repo = join(root, 'repo'), global = join(root, 'global.gitconfig')
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: global }
  const git = async args => (await execute('git', args, { env: gitEnvironment(env), windowsHide: true })).stdout
  try {
    await mkdir(repo); await git(['init', repo])
    await writeFile(global, '[user]\n name = Global Demo\n email = global@example.test\n')
    await run({ repo, global, env, git })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('reads per-field sources and atomically saves only repository config, not global settings or history', () => fixture(async ({ repo, global, env, git }) => {
  const before = await readFile(global, 'utf8')
  const first = await readIdentity(repo, { env })
  assert.equal(first.name, 'Global Demo'); assert.equal(first.nameSource.scope, 'global')
  const saved = await saveIdentity(repo, { ...first, name: "Work '$() & Name", email: 'work@example.test' }, { env })
  assert.equal(saved.name, "Work '$() & Name"); assert.equal(saved.email, 'work@example.test')
  assert.equal(saved.nameSource.scope, 'local'); assert.equal(saved.emailSource.scope, 'local')
  assert.equal(await readFile(global, 'utf8'), before)
  assert.equal((await git(['-C', repo, 'config', '--local', 'user.email'])).trim(), 'work@example.test')
  await assert.rejects(access(first.configPath + '.lock'))
  await assert.rejects(git(['-C', repo, 'rev-parse', '--verify', 'HEAD']))
}))

test('rejects invalid authors, stale drafts, external locks and worktree overrides', () => fixture(async ({ repo, env, git }) => {
  const first = await readIdentity(repo, { env })
  for (const name of ['', 'bad\nname', 'bad\0name', '<bad>']) assert.throws(() => validateAuthor(name, 'a@example.test'))
  assert.throws(() => validateAuthor('Name', 'not-an-email'))
  await writeFile(first.configPath + '.lock', 'another operation')
  await assert.rejects(saveIdentity(repo, { ...first, name: 'Other', email: 'other@example.test' }, { env }), /locked/)
  assert.equal(await readFile(first.configPath + '.lock', 'utf8'), 'another operation')
  await rm(first.configPath + '.lock')
  await git(['-C', repo, 'config', '--local', 'user.name', 'Changed externally'])
  await assert.rejects(saveIdentity(repo, { ...first, name: 'Other', email: 'other@example.test' }, { env }), /changed/)
  await git(['-C', repo, 'config', '--local', 'extensions.worktreeConfig', 'true'])
  await git(['-C', repo, 'config', '--worktree', 'user.email', 'worktree@example.test'])
  const worktree = await readIdentity(repo, { env })
  assert.equal(worktree.emailSource.scope, 'worktree'); assert.equal(worktree.canSave, false)
  await assert.rejects(saveIdentity(repo, { ...worktree, name: 'Other', email: 'other@example.test' }, { env }), /overrides/)
}))

test('workspace changes or a failed second config edit leave both original fields untouched', () => fixture(async ({ repo, env }) => {
  const first = await readIdentity(repo, { env }), original = await readFile(first.configPath, 'utf8')
  await assert.rejects(saveIdentity(repo, { ...first, name: 'Other', email: 'other@example.test' }, { env, beforeCommit: async () => { throw Error('Workspace changed') } }), /Workspace changed/)
  assert.equal(await readFile(first.configPath, 'utf8'), original)
  await assert.rejects(access(first.configPath + '.lock'))
  const failEmail = async (command, args, options) => {
    if (args.includes('--file') && args.includes('user.email')) throw Error('simulated failure')
    return execute(command, args, options)
  }
  await assert.rejects(saveIdentity(repo, { ...first, name: 'Other', email: 'other@example.test' }, { env, execute: failEmail }))
  assert.equal(await readFile(first.configPath, 'utf8'), original)
  await assert.rejects(access(first.configPath + '.lock'))
}))

test('clears inherited repository routing without changing global config selection', () => {
  assert.deepEqual(gitEnvironment({ GIT_DIR: 'bad', GIT_WORK_TREE: 'bad', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'bad', GIT_CONFIG_GLOBAL: 'keep', PATH: 'keep' }), { GIT_CONFIG_GLOBAL: 'keep', PATH: 'keep' })
})
