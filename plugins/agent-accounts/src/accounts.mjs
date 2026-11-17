import { text } from './i18n.mjs'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { win32 as path } from 'node:path'
import { promisify } from 'node:util'
import { homedir } from 'node:os'

const execute = promisify(execFile)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function localCliEnv(root, env = process.env) {
  // Omit remote selectors: this CLI treats even "local" as a saved environment name.
  const excluded = new Set(['ORCA_ENVIRONMENT', 'ORCA_PAIRING_CODE', 'ORCA_REMOTE_PAIRING', 'ORCA_USER_DATA_PATH'])
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => !excluded.has(key.toUpperCase()))),
    ORCA_USER_DATA_PATH: root,
  }
}

function cliFailure(cause) {
  try {
    const detail = JSON.parse(cause.stdout).error
    if (detail?.message) return Error(`${detail.code || 'Orca'}: ${detail.message}`)
  } catch { /* Do not echo the launch command or raw output. */ }
  return Error(`Orca CLI failed (${cause?.code || 'unknown'}). Check existing terminals before retrying.`)
}

export function runtime(env = process.env, platform = process.platform) {
  if (platform !== 'win32') throw Error(text('這個版本只支援 Windows。'))
  // Orca workers omit the session's environment; use Windows' per-user install paths there.
  const root = env.ORCA_USER_DATA_PATH || path.join(env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'orca')
  const cli = env.ORCA_CLI_COMMAND || path.join(env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'Programs', 'orca', 'resources', 'bin', 'orca.exe')
  if (!root || !path.isAbsolute(root) || !cli || !path.isAbsolute(cli)) throw Error(text('找不到 Orca 的本機資料夾或 CLI。'))
  return { root, cli }
}

function providerOf(value = 'codex') {
  if (value !== 'codex' && value !== 'claude') throw Error('Unsupported account provider.')
  return value
}

export function parseAccounts(body, root, provider = 'codex') {
  providerOf(provider)
  if (body?.ok !== true || !Array.isArray(body.result?.accounts)) throw Error(text('Orca 未回傳有效的帳號清單。'))
  return body.result.accounts.map(account => {
    if (!account || typeof account.id !== 'string' || !uuid.test(account.id)) throw Error(text('Orca 帳號 ID 格式不符，已停止載入。'))
    const displayName = typeof account.displayName === 'string' ? account.displayName.trim() : ''
    const label = displayName || [account.label || account.email || account.id, account.workspaceLabel].filter(Boolean).join(' · ')
    return {
      id: account.id,
      label,
      home: provider === 'claude' ? (typeof account.home === 'string' && path.isAbsolute(account.home) && !/[\r\n\0]/.test(account.home) ? account.home : '') : path.join(root, 'codex-accounts', account.id, 'home'),
      ...(provider === 'claude' ? { provider } : {}),
      disabledReason: account.managedHomeRuntime === 'wsl' || account.managedAuthRuntime === 'wsl' || account.wslDistro ? text('尚未支援 WSL 帳號。') :
        provider === 'claude' && (account.needsSignIn || account.runsOnSystemDefault || typeof account.home !== 'string' || !path.isAbsolute(account.home) || /[\r\n\0]/.test(account.home)) ? text('找不到可讀取的登入檔，請在 Orca 重新登入。') : '',
    }
  })
}

export async function listAccounts(options = {}) {
  const { root, cli } = options.runtime ?? runtime()
  const run = options.execute ?? execute
  const check = options.access ?? access
  const provider = providerOf(options.provider)
  let stdout
  try { ({ stdout } = await run(cli, ['account', 'list', '--agent', provider, '--json'], {
    windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
    // Always query the local host, even when the calling chat targets a paired runtime.
    env: localCliEnv(root),
  })) } catch (cause) {
    let message = text('無法呼叫 Orca CLI，請確認 Orca 正在執行。')
    try { message = JSON.parse(cause.stdout).error?.message || message } catch { /* Never expose raw child output. */ }
    throw Error(message)
  }
  let body
  try { body = JSON.parse(stdout) } catch { throw Error(text('無法解析 Orca 帳號清單。')) }
  const accounts = parseAccounts(body, root, provider)
  return Promise.all(accounts.map(async account => {
    if (!account.disabledReason) {
      try { await check(path.join(account.home, provider === 'claude' ? '.credentials.json' : 'auth.json'), constants.R_OK) }
      catch { account.disabledReason = text('找不到可讀取的登入檔，請在 Orca 重新登入。') }
    }
    return account
  }))
}

export async function listAllAccounts(options = {}) {
  const groups = await Promise.all(['codex', 'claude'].map(provider => listAccounts({ ...options, provider })))
  return groups.flat()
}

function powershell(script) {
  return 'powershell.exe -NoLogo -NoProfile -NoExit -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')
}

export function claudeCommand(home) {
  if (typeof home !== 'string' || !path.isAbsolute(home) || /[\r\n\0]/.test(home)) throw Error(text('無效的帳號資料夾。'))
  return powershell([
    "$ErrorActionPreference = 'Stop'",
    `$env:CLAUDE_CONFIG_DIR = '${home.replaceAll("'", "''")}'`,
    'Remove-Item Env:ANTHROPIC_API_KEY, Env:ANTHROPIC_AUTH_TOKEN, Env:CLAUDE_CODE_OAUTH_TOKEN, Env:ANTHROPIC_BASE_URL, Env:CLAUDE_CODE_USE_BEDROCK, Env:CLAUDE_CODE_USE_VERTEX, Env:CLAUDE_CODE_USE_FOUNDRY -ErrorAction SilentlyContinue',
    "if (!(Test-Path -LiteralPath (Join-Path $env:CLAUDE_CONFIG_DIR '.credentials.json') -PathType Leaf)) { throw 'Account sign-in file is missing. Sign in through Orca first.' }",
    "$app = Get-Command claude.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (!$app) { $app = Get-Command claude.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }",
    "if (!$app) { throw 'Claude CLI not found on PATH. Install Claude and restart Orca.' }",
    '& $app.Source',
  ].join('\n'))
}

export async function createLoginTerminal(workspaceId, provider, options = {}) {
  providerOf(provider)
  const { cli, root } = options.runtime ?? runtime()
  const command = powershell([
    "$ErrorActionPreference = 'Stop'",
    'Remove-Item Env:ORCA_ENVIRONMENT, Env:ORCA_PAIRING_CODE, Env:ORCA_REMOTE_PAIRING -ErrorAction SilentlyContinue',
    `$env:ORCA_USER_DATA_PATH = '${root.replaceAll("'", "''")}'`,
    `& '${cli.replaceAll("'", "''")}' account add --agent ${provider}`,
    "if ($LASTEXITCODE -ne 0) { throw 'Sign-in did not complete. Review the error above before retrying.' }",
    "Write-Host 'After signing in, return to the accounts panel and click Refresh.'",
  ].join('\n'))
  return createTerminal(workspaceId, { label: 'Sign in', provider }, { ...options, command, title: `${provider === 'claude' ? 'Claude' : 'Codex'} · Sign in` })
}

export function terminalCommand(home, options = {}) {
  if (typeof home !== 'string' || !path.isAbsolute(home) || /[\r\n\0]/.test(home)) throw Error(text('無效的帳號資料夾。'))
  const literal = "'" + home.replaceAll("'", "''") + "'"
  if (options.pipeName && !/^orca-codex-api-[a-f0-9]{64}$/.test(options.pipeName)) throw Error('Invalid credential pipe.')
  const apiSetup = options.pipeName ? [
    `$pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', '${options.pipeName}', [System.IO.Pipes.PipeDirection]::In)`,
    '$pipe.Connect(15000)',
    '$reader = [System.IO.StreamReader]::new($pipe)',
    'try { $credential = $reader.ReadLine() | ConvertFrom-Json; $env:OPENAI_API_KEY = $credential.key } finally { $reader.Dispose(); $pipe.Dispose() }',
    "if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw 'API credential was not received.' }",
    '$credential = $null',
  ] : ["if (!(Test-Path -LiteralPath (Join-Path $env:CODEX_HOME 'auth.json') -PathType Leaf)) { throw 'Account sign-in file is missing. Sign in through Orca first.' }"]
  // shortcut: direct CLI skips Orca's account preparation; replace when account-scoped native launch is public.
  // Use a fresh PowerShell and the real executable, bypassing Orca's codex shell function.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$env:CODEX_HOME = ${literal}`,
    ...apiSetup,
    "$codexApp = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (!$codexApp) { $codexApp = Get-Command codex.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }",
    "if (!$codexApp) { throw 'Codex CLI not found on PATH. Install Codex and restart Orca.' }",
    options.pipeName ? `& $codexApp.Source -c 'model_provider="orca_api"' -c 'model_providers.orca_api.name="OpenAI API"' -c 'model_providers.orca_api.base_url="https://api.openai.com/v1"' -c 'model_providers.orca_api.env_key="OPENAI_API_KEY"' -c 'model_providers.orca_api.wire_api="responses"' -c 'model_providers.orca_api.requires_openai_auth=false'` : '& $codexApp.Source',
  ].join('\n')
  return 'powershell.exe -NoLogo -NoProfile -NoExit -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')
}

export async function createTerminal(workspaceId, account, options = {}) {
  const { cli, root } = options.runtime ?? runtime()
  const run = options.execute ?? execute
  let stdout
  try { ({ stdout } = await run(cli, [
    'terminal', 'create', '--worktree', workspaceId,
    '--shell', 'powershell.exe',
    // Custom titles override session names in both tabs and sidebar agent rows.
    ...(options.title ? ['--title', options.title] : []),
    '--command', options.command ?? (account.provider === 'claude' ? claudeCommand(account.home) : terminalCommand(account.home)), '--focus', '--json',
  ], {
    windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024,
    env: localCliEnv(root),
  })) } catch (cause) { throw cliFailure(cause) }
  const body = JSON.parse(stdout)
  const terminal = body?.result?.terminal
  if (body?.ok !== true || typeof terminal?.handle !== 'string') throw Error(text('Orca 沒有回傳終端分頁，請先查看現有終端，避免重複開啟。'))
  if (terminal.orphaned === true || body.result.surface === 'background') throw Error(`Codex was created in the background, but Orca did not attach its tab. Terminal: ${terminal.handle}. Check it before retrying.`)
  return { terminalId: terminal.handle }
}
