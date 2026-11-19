export const providers = {
  codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity',
  gemini: 'Gemini', opencodeGo: 'OpenCode Go', kimi: 'Kimi Code', minimax: 'MiniMax',
  grok: 'Grok', cursor: 'Cursor', zcode: 'ZCode / GLM', muse: 'Muse Code',
  opencode: 'OpenCode', devin: 'Devin',
} as const

export type Provider = keyof typeof providers
export type UsageWindow = {
  kind: 'session' | 'weekly' | 'fableWeekly' | 'monthly' | 'bucket'
  label: string
  minutes: number
  used: number
  resetsAt: number
}
export type UsageRow = {
  key: string
  provider: Provider
  label: string
  detail: string
  system: boolean
  active: boolean
  plan: string
  status: 'available' | 'unavailable' | 'loading' | 'sign-in' | 'error'
  checkedAt: number
  windows: UsageWindow[]
}

declare module 'orca' {
  interface PluginRequests {
    'usage.read': { output: UsageRow[] }
  }
}
