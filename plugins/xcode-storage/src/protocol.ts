export type FolderSelection = { id: string; identity: string }

export type CacheFolder = FolderSelection & {
  name: string
  workspace: string | null
  missing: boolean
  size: number | null
}

export type ScanResult = { folders: CacheFolder[]; supported: boolean }
export type RemovalResult = { removed: string[]; errors: string[] }

declare module 'orca' {
  interface PluginRequests {
    'storage.scan': { output: ScanResult }
    'storage.remove': {
      input: { confirmed: true; folders: FolderSelection[] }
      output: RemovalResult
    }
  }
}
