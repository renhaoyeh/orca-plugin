export type Project = { id: string; name: string; workspaceId?: string; workspaceName?: string }
export type ConnectionState = { configured: boolean; url: string; scope?: string; binding?: Project | null; tab?: 'mine' | 'all' }
export type Issue = { id: string; title: string; status: string; assignee: string; url: string; section?: string; due?: string; subtasks?: number; assigneeId?: string; customFields?: { id: string; name: string; type: string; displayValue: string; color?: string }[]; parent?: { id: string; title: string } | null }
export type IssueDetail = Issue & { description: string; comments: { id: string; author: string; text: string; at?: string | null }[]; commentsError: string; truncated: boolean }
export type Page<T> = { items: T[]; next: string | null }
declare module 'orca' {
  interface PluginRequests {
    'connection.read': { output: ConnectionState }
    'connection.save': { input: { url: string; token: string }; output: ConnectionState }
    'connection.remove': { output: ConnectionState }
    'data.refresh': { output: { ok: true } }
    'project.bind': { input: { scope: string; id: string }; output: Project }
    'view.save': { input: { tab: 'mine' | 'all' }; output: { ok: true } }
    'projects.list': { input: { cursor: string | null; query?: string }; output: Page<Project> }
    'issues.subtasks': { input: { id: string }; output: Issue[] }
    'issues.detail': { input: { id: string; project?: string }; output: IssueDetail }
    'issues.list': { input: { project: string; cursor: string | null; tab?: 'mine' | 'all' }; output: Page<Issue> }
  }
}
