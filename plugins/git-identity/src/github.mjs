import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { localEnvironment } from './local-env.mjs'
const execute = promisify(execFile)
const valid = account => account && typeof account.host === 'string' && typeof account.login === 'string'
  && account.host.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(account.host)
  && account.login.length <= 100 && /^[a-z0-9][a-z0-9_.-]*$/i.test(account.login)
async function gh(args, options) {
  try {
    return JSON.parse((await (options.execute ?? execute)('gh', args, {
      env: { ...localEnvironment(), GH_PROMPT_DISABLED: '1', ...options.env },
      timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024,
    })).stdout)
  } catch { throw Error('Could not read GitHub data. Check gh installation, network and gh auth login, then retry.') }
}
// Project only public metadata in gh itself: never request or return tokens.
export async function listGitHubAccounts(options = {}) {
  const rows = await gh(['auth', 'status', '--json', 'hosts', '--jq', '[.hosts[][] | {host,login,state}]'], options)
  if (!Array.isArray(rows)) throw Error('Unexpected GitHub account response. Update gh and retry.')
  return rows.filter(valid).map(({ host, login, state }) => ({ host, login, available: state === 'success' }))
}
export async function readGitHubAuthor(account, options = {}) {
  if (!valid(account)) throw Error('Invalid GitHub account.')
  const profile = await gh(['api', `users/${account.login}`, '--hostname', account.host, '--jq', '{login,name,email}'], options)
  if (typeof profile?.login !== 'string' || profile.login.toLowerCase() !== account.login.toLowerCase()) throw Error('GitHub profile does not match the selected account.')
  return {
    name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : account.login,
    email: typeof profile.email === 'string' ? profile.email.trim() : '',
  }
}
