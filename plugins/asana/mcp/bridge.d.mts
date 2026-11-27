import type { McpCaller } from '../src/worker'
import type { IssueDetail } from '../src/protocol'

export function bridgeDirectory(): string
export function startMcpBridge(
  currentTask: (caller: McpCaller) => Promise<IssueDetail | null>,
  directory?: string,
): Promise<() => Promise<void>>
