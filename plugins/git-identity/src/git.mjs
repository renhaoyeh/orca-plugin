import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, lstat, open, rename, unlink, chmod } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { localEnvironment } from './local-env.mjs'

const execute = promisify(execFile)

// Never let the worker's inherited repository/command routing redirect a save.
export function gitEnvironment(env = localEnvironment()) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/i.test(key)))
}

export function runner(options = {}) {
  return async (cwd, args) => {
    try {
      return (await (options.execute ?? execute)('git', ['-C', cwd, ...args], {
        env: gitEnvironment(options.env), windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024,
      })).stdout
    } catch (cause) {
      // Missing config is an ordinary unset value, not a process failure.
      if (((cause.code === 1 && (args.includes('--get') || args.includes('--get-all'))) || (cause.code === 5 && args.includes('--unset-all'))) && !cause.stdout && !cause.stderr) return ''
      throw Error('Git could not read or update this repository. Check Git installation, repository access and config locks.')
    }
  }
}

function field(output) {
  if (!output) return { value: '', scope: 'unset', origin: '' }
  const parts = output.split('\0')
  if (parts.length !== 4 || parts[3] !== '') throw Error('Unexpected Git config response.')
  return { scope: parts[0], origin: parts[1], value: parts[2] }
}

async function configFile(file) {
  try {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Repository config must be a regular file, not a symbolic link.')
    return { bytes: await readFile(file), mode: stat.mode }
  } catch (cause) {
    if (cause.code === 'ENOENT') return { bytes: Buffer.alloc(0), mode: 0o600 }
    throw cause
  }
}

export async function readIdentity(cwd, options = {}) {
  const git = runner(options)
  const repoPath = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  if (!path.isAbsolute(repoPath)) throw Error('Open a local Git working tree first.')
  const common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  if (!path.isAbsolute(common)) throw Error('Git did not return an absolute config directory.')
  const configPath = path.join(common, 'config')
  const [nameOutput, emailOutput, file] = await Promise.all([
    git(cwd, ['config', '--null', '--show-scope', '--show-origin', '--get', 'user.name']),
    git(cwd, ['config', '--null', '--show-scope', '--show-origin', '--get', 'user.email']),
    configFile(configPath),
  ])
  const name = field(nameOutput), email = field(emailOutput)
  const revision = createHash('sha256').update(file.bytes).update(JSON.stringify([repoPath, name, email])).digest('hex')
  const env = options.env ?? process.env
  return {
    repoPath, configPath, name: name.value, email: email.value,
    nameSource: { scope: name.scope, origin: name.origin }, emailSource: { scope: email.scope, origin: email.origin },
    revision, canSave: ![name.scope, email.scope].some(scope => scope === 'worktree' || scope === 'command'),
    environmentOverride: ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL'].some(key => !!env[key]),
  }
}

export function validateAuthor(name, email) {
  if (typeof name !== 'string' || typeof email !== 'string' || !name.trim() || !email.trim()
    || name.length > 200 || email.length > 254 || /[\x00-\x1f\x7f<>]/.test(name + email)
    || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) throw Error('Enter a name and email without control characters or angle brackets.')
  return { name: name.trim(), email: email.trim() }
}

export async function saveIdentity(cwd, input, options = {}) {
  const author = validateAuthor(input.name, input.email)
  return mutateRepository(cwd, input, async (git, lock) => {
    await git(cwd, ['config', '--file', lock, '--replace-all', 'user.name', author.name])
    await git(cwd, ['config', '--file', lock, '--replace-all', 'user.email', author.email])
  }, options)
}

export async function mutateRepository(cwd, input, edit, options = {}) {
  const current = await readIdentity(cwd, options)
  if (current.repoPath !== input.repoPath || current.revision !== input.revision) throw Error('Git identity or repository changed. Refresh before saving.')
  if (!current.canSave && !options.allowOverrides) throw Error('A worktree or command-level identity overrides repository settings. Resolve that override before saving.')
  const git = runner(options), lock = current.configPath + '.lock'
  let owned = false
  try {
    // Use Git's normal config lock. Both edits are prepared off-file, then published together.
    const original = await configFile(current.configPath)
    const handle = await open(lock, 'wx', 0o600)
    owned = true
    try { await handle.writeFile(original.bytes) } finally { await handle.close() }
    // Re-read under the lock to catch changes between the initial check and lock acquisition.
    if ((await readIdentity(cwd, options)).revision !== input.revision) throw Error('Git identity changed. Refresh before saving.')
    await edit(git, lock)
    await chmod(lock, original.mode & 0o777)
    await options.beforeCommit?.()
    if (!(await configFile(current.configPath)).bytes.equals(original.bytes)) throw Error('Repository config changed. Refresh before saving.')
    await rename(lock, current.configPath)
    owned = false
  } catch (cause) {
    if (cause.code === 'EEXIST') throw Error('Git config is locked by another operation. Wait, then try again.')
    throw cause
  } finally {
    if (owned) await unlink(lock).catch(() => {})
  }
  return readIdentity(cwd, options)
}
