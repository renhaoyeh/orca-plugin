import type { OrcaWorkerApi } from 'orca/worker'
import type { ScanResult, RemovalResult } from './protocol'
import { localXcodeHome, scan, remove } from './derived-data.mjs'

export default function activate(orca: OrcaWorkerApi) {
  orca.panels.handle('storage.scan', async (_, { signal }): Promise<ScanResult> => {
    const home = localXcodeHome()
    if (!home) return { folders: [], supported: false }
    return { folders: await scan(home, signal), supported: true }
  })
  orca.panels.handle('storage.remove', (input, { signal }): RemovalResult => {
    const home = localXcodeHome()
    if (!home) throw new Error('Xcode Storage requires macOS.')
    signal.throwIfAborted()
    if (input?.confirmed !== true || !Array.isArray(input.folders) || !input.folders.length) {
      throw new Error('Select and confirm DerivedData folders before deleting.')
    }
    return remove(home, input.folders)
  })
}
