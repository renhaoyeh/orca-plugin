export const connected = { configured: true, url: 'https://app.asana.com', workspaceId: 'workspace-a', scope: 'repo-a', binding: null, tab: 'mine' as const }
export const projects = { items: [{ id: '12', name: 'Demo project', workspaceId: '1', workspaceName: 'Demo workspace' }], next: null }
export const issues = { items: [{ id: '42', title: 'Fix login redirect', status: 'Open', assignee: 'Demo User', section: 'In progress', due: '2027-01-01', url: 'https://app.asana.com/0/12/42' }, { id: '43', title: 'Update settings form', status: 'Open', assignee: '', section: 'Backlog', due: '', url: '' }], next: null }
export const detail = { ...issues.items[0], subtasks: 1, customFields: [{ id: 'priority', name: 'Priority', type: 'enum', displayValue: 'High', color: 'red' }, { id: 'estimate', name: 'Estimate', type: 'number', displayValue: '5' }], description: 'Login redirects to the wrong page.\nExpected: return to the requested page.', comments: [{ id: '1', author: 'Demo User', text: 'Reproduced in the latest version.' }], commentsError: '', truncated: false }
export const requests = {
  'data.refresh': () => ({ ok: true as const }),
  'connection.read': () => connected, 'projects.list': () => projects, 'issues.list': () => issues, 'issues.detail': () => detail,
  'issues.subtasks': () => [{ ...issues.items[0], id: '44', title: 'Check redirect target', subtasks: 0 }],
  'project.bind': () => projects.items[0], 'view.save': () => ({ ok: true as const }),
}
