import { createServer } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { win32 as path } from 'node:path'
import { runtime, createTerminal, terminalCommand } from './accounts.mjs'

const profileId = /^api-[a-f0-9-]{36}$/

export function newApiProfile(name, key) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40 || /[\r\n\0]/.test(name)) throw Error('Enter a profile name (1–40 characters).')
  if (typeof key !== 'string' || !/^[\x21-\x7e]{16,1024}$/.test(key.trim())) throw Error('Enter a valid API key without spaces or line breaks.')
  return { id: `api-${randomUUID()}`, name: name.trim() }
}

export function parseApiProfiles(value) {
  if (value == null) return []
  if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string' || !profileId.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40)) throw Error('API profile metadata is invalid. No profiles were changed.')
  if (new Set(value.map(item => item.id)).size !== value.length) throw Error('Duplicate API profile IDs.')
  return value.map(({ id, name }) => ({ id, name }))
}

export async function openKeyPipe(key, options = {}) {
  const name = `orca-codex-api-${randomBytes(32).toString('hex')}`
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : name
  if (process.platform !== 'win32') throw Error('API terminal launch supports Windows only.')
  let payload = Buffer.from(JSON.stringify({ key }) + '\n')
  let consumed = false
  const sockets = new Set()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => sockets.delete(socket))
    if (consumed) return socket.destroy()
    consumed = true
    socket.end(payload, () => payload.fill(0))
    server.close()
  })
  const close = () => {
    clearTimeout(timer)
    for (const socket of sockets) socket.destroy()
    server.close()
    payload.fill(0)
  }
  const timer = setTimeout(close, options.timeoutMs ?? 60000)
  timer.unref()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(address, () => { server.off('error', reject); resolve() })
    })
  } catch { close(); throw Error('Could not open the local credential channel.') }
  server.on('error', close)
  server.unref()
  return { name, address, close }
}

export async function createApiTerminal(workspaceId, profile, key, options = {}) {
  if (!profileId.test(profile.id)) throw Error('Invalid API profile ID.')
  if (!key) throw Error('API key is missing. Remove this profile and add it again.')
  const paths = options.runtime ?? runtime()
  const home = path.join(paths.root, 'codex-accounts-plugin', 'api-homes', profile.id)
  await (options.mkdir ?? mkdir)(home, { recursive: true })
  const pipe = await (options.openKeyPipe ?? openKeyPipe)(key)
  try {
    // Only the unpredictable pipe name is in the command; the credential travels locally once.
    return await (options.createTerminal ?? createTerminal)(workspaceId,
      { home, label: `${profile.name} · API` },
      { runtime: paths, command: terminalCommand(home, { pipeName: pipe.name }) })
  } catch { pipe.close(); throw Error('Could not open the API terminal. Check existing tabs before retrying.') }
}
