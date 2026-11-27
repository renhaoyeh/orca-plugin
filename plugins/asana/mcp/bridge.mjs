import { randomBytes, timingSafeEqual } from 'node:crypto'
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './server.mjs'

export function bridgeDirectory() {
  return join(homedir(), '.orca-asana-mcp')
}

export async function startMcpBridge(api, currentTask, directory = bridgeDirectory()) {
  const key = randomBytes(32).toString('hex')
  const sockets = new Set()
  const listener = createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
    socket.setTimeout(5000, () => socket.destroy())
    let pending = Buffer.alloc(0)
    const authenticate = chunk => {
      pending = Buffer.concat([pending, chunk])
      const end = pending.indexOf(10)
      if (end > 8192 || (end < 0 && pending.length > 8192)) return socket.destroy()
      if (end < 0) return
      let hello
      try { hello = JSON.parse(pending.subarray(0, end).toString('utf8')) } catch { return socket.destroy() }
      if (typeof hello?.key !== 'string' || !/^[a-f0-9]{64}$/.test(hello.key) ||
          !timingSafeEqual(Buffer.from(hello.key), Buffer.from(key)) || typeof hello.cwd !== 'string') return socket.destroy()

      socket.setTimeout(0)
      socket.pause()
      socket.off('data', authenticate)
      socket.unshift(pending.subarray(end + 1))
      pending = null
      const server = createMcpServer(api, () => currentTask(hello))
      const transport = new StdioServerTransport(socket, socket, { maxBufferSize: 1024 * 1024 })
      socket.once('close', () => { void server.close().catch(() => {}) })
      void server.connect(transport).then(() => socket.resume(), () => socket.destroy())
    }
    socket.on('data', authenticate)
  })
  const close = () => new Promise(resolve => {
    listener.close(resolve)
    for (const socket of sockets) socket.destroy()
  })
  const descriptor = join(directory, 'bridge.json')
  const temporary = join(directory, `bridge-${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077)))) {
    throw Error('The Asana MCP bridge directory must be private to the current user.')
  }
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve))
  try {
    await writeFile(temporary, JSON.stringify({ port: listener.address().port, key }), { mode: 0o600, flag: 'wx' })
    await rename(temporary, descriptor)
  } catch (error) {
    await close()
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  return close
}
