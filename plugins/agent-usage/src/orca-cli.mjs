import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

function cliPath() {
  if (process.env.ORCA_CLI_COMMAND) return process.env.ORCA_CLI_COMMAND
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const installed = join(base, 'Programs', 'orca', 'resources', 'bin', 'orca.exe')
    return existsSync(installed) ? installed : 'orca.exe'
  }
  return process.platform === 'linux' ? 'orca-ide' : 'orca'
}

export async function readAccountSnapshot() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^ORCA_(ENVIRONMENT|PAIRING_CODE|REMOTE_PAIRING_CODE)$/i.test(key)))
  if (process.platform === 'win32' && !env.ORCA_USER_DATA_PATH) {
    env.ORCA_USER_DATA_PATH = join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'orca')
  }
  try {
    const { stdout } = await execute(cliPath(), ['account', 'list', '--json'], {
      env, windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
    })
    const response = JSON.parse(stdout)
    if (response?.ok === true && response.result) return /** @type {unknown} */ (response.result)
  } catch (cause) {
    // Surface the failure class without publishing stdout, stderr, or account data.
    let code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : 'invalid-response'
    if (cause && typeof cause === 'object' && 'stdout' in cause && typeof cause.stdout === 'string') {
      try { code = JSON.parse(cause.stdout).error?.code || code } catch {}
    }
    console.warn('Orca account list did not complete:', /^[\w-]+$/.test(code) ? code : 'unknown')
  }
  throw Error('Could not read usage from the Orca CLI.')
}
