import { homedir } from 'node:os'
import { win32 as path } from 'node:path'
// Orca workers omit APPDATA/HOME. Restore standard local-user locations without
// reading credential files ourselves; gh still owns keyring/config access.
export function localEnvironment(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return { ...env }
  const home = env.USERPROFILE || homedir()
  return { ...env, HOME: env.HOME || home, USERPROFILE: home,
    APPDATA: env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: env.LOCALAPPDATA || path.join(home, 'AppData', 'Local') }
}
