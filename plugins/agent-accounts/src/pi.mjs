import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runtime, localCliEnv } from './accounts.mjs'

const execute = promisify(execFile)

// Ask Orca for its native Pi Chat UI. Never import account credentials,
// override PI_CODING_AGENT_DIR, submit a prompt, or bypass project trust.
export async function launchPi(workspaceId, options = {}) {
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw Error('A workspace is required.')
  const { cli, root } = options.runtime ?? runtime()
  const run = options.execute ?? execute
  let stdout
  try {
    ;({ stdout } = await run(cli, [
      'agent', 'launch', '--agent', 'pi', '--worktree', workspaceId,
      '--surface', 'chat', '--focus', '--json',
    ], {
      windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024,
      env: localCliEnv(root),
    }))
  } catch (cause) {
    let detail
    try { detail = JSON.parse(cause.stdout)?.error?.message } catch { /* Do not expose raw commands or output. */ }
    throw Error(detail || 'Pi launch could not be confirmed. Check existing tabs before retrying.')
  }
  let body
  try { body = JSON.parse(stdout) } catch { throw Error('Pi launch could not be confirmed. Check existing tabs before retrying.') }
  if (body?.ok !== true) throw Error(body?.error?.message || 'Pi launch could not be confirmed. Check existing tabs before retrying.')
  const outcome = (body.result?.launch ?? body.result)?.outcome
  if (outcome?.kind === 'terminal') {
    throw Error('Orca opened a Pi CLI terminal instead of Chat. Check the existing tab; no additional session was started by this plugin.')
  }
  if (outcome?.kind !== 'structured') {
    throw Error('Pi Chat launch could not be confirmed. Check existing tabs before retrying.')
  }
  return { accepted: true }
}
