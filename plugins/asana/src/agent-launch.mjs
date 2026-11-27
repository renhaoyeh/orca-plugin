import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function cliPath() {
  if (process.env.ORCA_CLI_COMMAND) return process.env.ORCA_CLI_COMMAND
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const installed = join(base, 'Programs', 'orca', 'resources', 'bin', 'orca.exe')
    return existsSync(installed) ? installed : 'orca.exe'
  }
  return process.platform === 'linux' ? 'orca-ide' : 'orca'
}

export function runOrcaCli(args) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^ORCA_(ENVIRONMENT|PAIRING_CODE|REMOTE_PAIRING_CODE)$/i.test(key)))
    if (process.platform === 'win32' && !env.ORCA_USER_DATA_PATH) {
      env.ORCA_USER_DATA_PATH = join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'orca')
    }
    execFile(cliPath(), args, { env, windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      let response
      try { response = JSON.parse(stdout) } catch {}
      if (!error && response?.ok === true) return resolve(response.result)
      const code = String(response?.error?.code ?? error?.code ?? 'invalid-response')
      console.warn('Orca Agent action did not complete:', /^[\w-]+$/.test(code) ? code : 'unknown')
      const message = args[1] === 'launch'
        ? 'Launch status is unknown. Check the workspace before trying again.'
        : 'Could not find Agents.'
      reject(new Error(message))
    })
  })
}

function workspaceSelector(workspaceId) {
  return /^(identity|folder|id):/.test(workspaceId) ? workspaceId : 'id:' + workspaceId
}

export async function installedAgents(run, workspaceId) {
  const result = await run(['agent', 'installed', '--worktree', workspaceSelector(workspaceId), '--json'])
  if (!Array.isArray(result?.agents)) throw new Error('Orca did not return available Agents.')
  return result.agents.filter(agent => typeof agent?.id === 'string' && typeof agent?.name === 'string')
    .map(agent => ({ id: agent.id, name: agent.name, default: Boolean(agent.default) }))
}

/** @returns {Promise<{ started: true }>} */
export async function launchAgent(run, workspaceId, agent, prompt) {
  if (prompt.length > 7000) throw new Error('The Agent prompt is too long. Shorten it before launching.')
  await run(['agent', 'launch', '--agent', agent, '--worktree', workspaceSelector(workspaceId), '--prompt', prompt, '--focus', '--json'])
  return { started: true }
}
