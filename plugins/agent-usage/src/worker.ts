import type { OrcaWorkerApi } from 'orca/worker'
import { readAccountSnapshot } from './orca-cli.mjs'
import { readRoster } from './usage'

export default function activate(orca: OrcaWorkerApi) {
  let pending: ReturnType<typeof load> | undefined
  async function load() {
    return readRoster(await readAccountSnapshot())
  }
  orca.panels.handle('usage.read', () => {
    pending ??= load().finally(() => { pending = undefined })
    return pending
  })
}
