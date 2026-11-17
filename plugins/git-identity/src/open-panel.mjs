import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { win32 as path } from 'node:path'
import { homedir } from 'node:os'

export async function openPanel() {
  if (process.platform !== 'win32') throw Error('This prototype supports the local Windows host only.')
  const root = process.env.ORCA_USER_DATA_PATH || path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'orca')
  const cli = process.env.ORCA_CLI_COMMAND || path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'Programs', 'orca', 'resources', 'bin', 'orca.exe')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^ORCA_(ENVIRONMENT|PAIRING_CODE|REMOTE_PAIRING|USER_DATA_PATH)$/i.test(key)))
  await promisify(execFile)(cli, ['plugin', 'open', 'local.git-identity', '--panel', 'identity', '--json'], {
    windowsHide: true, timeout: 10000, env: { ...env, ORCA_USER_DATA_PATH: root },
  })
}
