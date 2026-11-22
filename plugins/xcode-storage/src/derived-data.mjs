import { execFile, execFileSync } from 'node:child_process'
import { constants, lstatSync, realpathSync, rmSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const rootParts = ['Library', 'Developer', 'Xcode', 'DerivedData']
const isAbsent = error => error.code === 'ENOENT' || error.code === 'ENOTDIR'
const isFolderName = name => typeof name === 'string' && name.length > 0 &&
  !name.startsWith('.') && !/[/\\\0]/.test(name)
const identityOf = info => [info.dev, info.ino, info.birthtimeNs].join(':')

export function localXcodeHome() {
  return process.platform === 'darwin' ? homedir() : null
}

function directoryInfo(path) {
  const info = lstatSync(path, { bigint: true })
  if (!info.isDirectory()) throw new Error('Expected a directory without symlinks.')
  return info
}

function derivedDataRoot(home) {
  let path = realpathSync(home)
  for (const part of rootParts) {
    path = join(path, part)
    directoryInfo(path)
  }
  return path
}

export function parseWorkspace(text) {
  const raw = /<key>\s*WorkspacePath\s*<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1]
  if (!raw) return null
  const entities = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }
  const path = raw.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[a-f\d]+);/gi, (match, entity) => {
    if (Object.hasOwn(entities, entity)) return entities[entity]
    if (!entity.startsWith('#')) return match
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
  return absoluteWorkspace(path)
}

function absoluteWorkspace(path) {
  return isAbsolute(path) && !path.includes('\0') ? path : null
}

async function readWorkspace(path) {
  try {
    const file = await open(join(path, 'info.plist'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      // Read at most 64 KiB of metadata, including when Xcode is rewriting the plist.
      if (!info.isFile() || info.size >= 65536) return null
      const buffer = Buffer.alloc(65536)
      const { bytesRead } = await file.read(buffer)
      const bytes = buffer.subarray(0, bytesRead)
      if (bytes.toString('ascii', 0, 8) === 'bplist00' && process.platform === 'darwin') {
        const path = execFileSync('/usr/bin/plutil',
          ['-extract', 'WorkspacePath', 'raw', '-expect', 'string', '-n', '-'],
          { input: bytes, encoding: 'utf8', maxBuffer: 65536, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
        return absoluteWorkspace(path)
      }
      return parseWorkspace(bytes.toString('utf8'))
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}

async function isMissing(workspace) {
  try {
    await stat(workspace)
    return false
  } catch (error) {
    return isAbsent(error)
  }
}

async function directorySize(path, signal) {
  let output
  try {
    ({ stdout: output } = await run('/usr/bin/du', ['-Psk', path], { signal, maxBuffer: 65536 }))
  } catch {
    signal?.throwIfAborted()
    return null
  }
  const kilobytes = /^\d+(?=\s)/.exec(output)?.[0]
  return kilobytes === undefined ? null : Number(kilobytes) * 1024
}

export async function scan(home, signal) {
  let root
  let entries
  try {
    root = derivedDataRoot(home)
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isAbsent(error)) return []
    throw error
  }

  const folders = []
  for (const entry of entries) {
    signal?.throwIfAborted()
    if (!entry.isDirectory() || !isFolderName(entry.name)) continue
    const path = join(root, entry.name)
    let info
    try {
      info = lstatSync(path, { bigint: true })
    } catch (error) {
      if (isAbsent(error)) continue
      throw error
    }
    if (!info.isDirectory()) continue
    const workspace = await readWorkspace(path)
    folders.push({
      id: entry.name,
      identity: identityOf(info),
      name: entry.name.replace(/-[a-z]{28}$/, '') || entry.name,
      workspace,
      missing: workspace !== null && await isMissing(workspace),
      size: await directorySize(path, signal),
    })
  }
  return folders.sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || a.id.localeCompare(b.id))
}

export function remove(home, selected) {
  const removed = []
  const errors = []
  const seen = new Set()
  for (const item of selected) {
    const id = item?.id
    try {
      if (!isFolderName(id) || typeof item.identity !== 'string') throw new Error('Invalid folder selection.')
      if (seen.has(id)) continue
      seen.add(id)
      const root = derivedDataRoot(home)
      const path = join(root, id)
      // Recheck the directory and its identity immediately before removing it.
      // Recursive rm unlinks symlinks inside the folder instead of following them.
      if (identityOf(directoryInfo(path)) !== item.identity) {
        throw new Error('Folder changed since the scan. Refresh and select it again.')
      }
      rmSync(path, { recursive: true })
      removed.push(id)
    } catch (error) {
      const message = isAbsent(error) ? 'Folder is no longer available.' : error.message
      errors.push(typeof id === 'string' ? id + ': ' + message : message)
    }
  }
  return { removed, errors }
}
