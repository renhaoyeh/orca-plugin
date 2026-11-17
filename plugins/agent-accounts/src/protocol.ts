export type AccountState = {
  accounts: { id: string; label: string; identityLabel?: string; disabledReason: string; kind?: string; provider?: string }[]
  workspaceId: string | null
  workspaceName: string
  workspaceError: string
  language?: string
}

declare module 'orca' {
  interface PluginRequests {
    'accounts.pi.add': { output: AccountState }
    'accounts.pi.remove': { output: AccountState }
    'accounts.list': { output: AccountState }
    'accounts.locale': { input: { locale: string }; output: AccountState }
    'accounts.add': { input: { provider: 'codex' | 'claude'; workspaceId: string }; output: { terminalId: string } | { pending: true } }
    'accounts.launch': { input: { accountId: string; workspaceId: string }; output: { terminalId: string } | { accepted: boolean } | { pending: true } }
    'accounts.rename': { input: { accountId: string; name: string }; output: AccountState }
    'accounts.api.add': { input: { name: string; key: string }; output: AccountState }
    'accounts.api.remove': { input: { accountId: string }; output: AccountState }
  }
}
