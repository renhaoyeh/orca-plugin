export type Project = { id: string; name: string; workspaceId?: string; workspaceName?: string }
export type ConnectionState = { configured: boolean; url: string; scope?: string; binding?: Project | null; tab?: 'mine' | 'all' }
export type Issue = { statusId?: number; statusName?: string; statusColor?: string; priority?: string; priorityId?: number; severity?: string; category?: string; resolution?: string; reproducibility?: string; reporter?: string; viewStatus?: string; projectName?: string; createdAt?: string; updatedAt?: string; noteCount?: number; attachmentCount?: number; tags?: string[]; id: string; title: string; status: string; assignee: string; url: string; section?: string; due?: string; subtasks?: number; assigneeId?: string; customFields?: { id: string; name: string; type: string; displayValue: string; color?: string }[]; parent?: { id: string; title: string } | null }
type IssueImage = { id: string; name: string }
type IssueAttachment = IssueImage & { image?: boolean; at?: string | null; author?: string; authorId?: string }
export type IssueDetail = Issue & { description: string; reproductionSteps?: string; attachments?: IssueAttachment[]; comments: { id: string; author: string; text: string; at?: string | null; images?: IssueImage[]; attachments?: IssueAttachment[] }[]; commentsError: string; truncated: boolean }
export type Page<T> = { items: T[]; next: string | null }
export type FieldSurface = 'list' | 'detail'
export type FieldOption = { id: string; name: string; choices?: string[] }
export type FieldPreference = { id: string; visible: boolean }
export type PriorityColor = { value: string; color: string }
export type FieldLayout = Partial<Record<FieldSurface, FieldPreference[]>> & { priorityColors?: PriorityColor[] }
type FieldProject = { project: string; url: string }
type IssueSelection = { project: string; scope: string }
declare module 'orca' {
  interface PluginRequests {
    'connection.read': { output: ConnectionState }
    'connection.save': { input: { url: string; token: string }; output: ConnectionState }
    'connection.remove': { output: ConnectionState }
    'data.refresh': { output: { ok: true } }
    'project.bind': { input: { scope: string; id: string }; output: Project }
    'view.save': { input: { tab: 'mine' | 'all' }; output: { ok: true } }
    'projects.list': { input: { cursor: string | null; query?: string }; output: Page<Project> }
    'fields.read': { input: FieldProject; output: FieldLayout }
    'fields.catalog': { input: FieldProject; output: FieldOption[] }
    'fields.save': { input: FieldProject & { layout: FieldLayout }; output: FieldLayout }
    'issues.subtasks': { input: { id: string }; output: Issue[] }
    'issues.detail': { input: { id: string; project?: string }; output: IssueDetail }
    'images.preview': { input: { issueId: string; fileId: string }; output: string }
    'issues.selection.read': { input: IssueSelection; output: { id: string | null } }
    'issues.selection.save': { input: IssueSelection & { id: string | null }; output: { ok: true } }
    'issues.list': { input: { project: string; cursor: string | null; tab?: 'mine' | 'all' }; output: Page<Issue> }
    'agent.options': { output: { workspaceId: string; agents: { id: string; name: string; default: boolean }[] } }
    'agent.launch': { input: { workspaceId: string; agent: string; prompt: string }; output: { started: true } }
  }
}
