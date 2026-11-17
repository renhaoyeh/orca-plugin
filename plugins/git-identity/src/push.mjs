import { runner, readIdentity, mutateRepository } from './git.mjs'

const metadataKey = 'orca.githubbinding'
const valid = account => account && typeof account.host === 'string' && typeof account.login === 'string'
  && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(account.host) && /^[a-z0-9][a-z0-9_.-]*$/i.test(account.login)
// Same routing as herdr-zed: evaluated by Git's shell only when credentials are requested.
export function credentialConfig(account) {
  if (!valid(account)) throw Error('Invalid GitHub account.')
  const { host, login } = account
  const helper = '!f() { [ "$1" = get ] || return 0; '
    + 'protocol=; host=; while IFS= read -r line && [ -n "$line" ]; do '
    + 'case "$line" in protocol=*) protocol=${line#protocol=};; host=*) host=${line#host=};; esac; done; '
    + `[ "$protocol" = https ] && [ "$host" = '${host}' ] || return 0; `
    + 'unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN; '
    + `token=$(gh auth token --hostname '${host}' --user '${login}') || { printf 'quit=true\\n'; return 1; }; `
    + `[ -n "$token" ] || { printf 'quit=true\\n'; return 1; }; printf 'username=%s\\npassword=%s\\n' '${login}' "$token"; }; f`
  return [
    { key: `credential.https://${host}.helper`, values: ['', helper] },
    { key: `credential.https://${host}.username`, values: [login] },
    { key: `url.https://${host}/.insteadOf`, values: [`git@${host}:`, `ssh://git@${host}/`] },
  ]
}
async function values(git, cwd, file, key) {
  const raw = await git(cwd, ['config', '--file', file, '--null', '--get-all', key])
  return raw ? raw.slice(0, -1).split('\0') : []
}
async function binding(git, cwd, file) {
  const rows = await values(git, cwd, file, metadataKey)
  if (!rows.length) return null
  try {
    if (rows.length !== 1) throw Error()
    const record = JSON.parse(rows[0])
    if (!valid(record) || record.version !== 1 || !Array.isArray(record.previous)) throw Error()
    const expected = credentialConfig(record)
    if (record.previous.length !== expected.length || record.previous.some((entry, i) => entry.key !== expected[i].key || !Array.isArray(entry.values) || entry.values.some(value => typeof value !== 'string'))) throw Error()
    return record
  } catch { throw Error('GitHub binding metadata is invalid. Inspect repository config before changing the binding.') }
}
async function intact(git, cwd, file, account) {
  for (const entry of credentialConfig(account)) {
    if (JSON.stringify(await values(git, cwd, file, entry.key)) !== JSON.stringify(entry.values)) return false
  }
  return true
}
export async function readPushBinding(cwd, options = {}) {
  const identity = await readIdentity(cwd, options), git = runner(options)
  const record = await binding(git, cwd, identity.configPath)
  return record ? { host: record.host, login: record.login, managed: await intact(git, cwd, identity.configPath, record) } : null
}
export async function savePushBinding(cwd, input, options = {}) {
  if (input.account !== null && !valid(input.account)) throw Error('Invalid GitHub account.')
  return mutateRepository(cwd, input, async (git, file) => {
    async function replace(entry) {
      await git(cwd, ['config', '--file', file, '--unset-all', entry.key])
      for (const value of entry.values) await git(cwd, ['config', '--file', file, '--add', entry.key, value])
    }
    const old = await binding(git, cwd, file)
    if (old) {
      if (!await intact(git, cwd, file, old)) throw Error('Push settings were edited outside this plugin. Refusing to overwrite them.')
      for (const entry of old.previous) await replace(entry)
      await git(cwd, ['config', '--file', file, '--unset-all', metadataKey])
    }
    if (input.account) {
      const config = credentialConfig(input.account), previous = []
      for (const entry of config) previous.push({ key: entry.key, values: await values(git, cwd, file, entry.key) })
      for (const entry of config) await replace(entry)
      await git(cwd, ['config', '--file', file, '--add', metadataKey, JSON.stringify({ version: 1, host: input.account.host, login: input.account.login, previous })])
    }
  }, { ...options, allowOverrides: true })
}
