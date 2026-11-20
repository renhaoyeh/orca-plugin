export const connected = { configured: true, url: 'https://mantis.example.test', scope: 'repo-a', binding: null, tab: 'mine' as const }
export const projects = { items: [{ id: '12', name: 'Demo project', workspaceId: '1', workspaceName: 'Demo workspace' }], next: null }
export const issues = { items: [{ id: '42', title: 'Fix login redirect', status: 'assigned', statusName: 'assigned', priority: 'High', priorityId: 50, category: 'Login', noteCount: 1, assignee: 'Demo User', section: 'Assigned', due: '2027-01-01', url: 'https://mantis.example.test/view.php?id=42' }, { id: '43', title: 'Update settings form', status: 'new', statusName: 'new', statusColor: '#e3b7eb', assignee: '', section: 'New', due: '', url: '' }], next: null }
export const detail = { ...issues.items[0], priority: 'High', priorityId: 50, severity: 'Major', category: 'Login', reporter: 'Reporter', resolution: 'Open', reproducibility: 'Always', tags: ['regression'], attachmentCount: 2, subtasks: 1, customFields: [{ id: 'version', name: 'Target version', type: 'text', displayValue: '1.2' }, { id: 'estimate', name: 'Estimate', type: 'number', displayValue: '5' }], description: 'Login redirects to the wrong page.\nExpected: return to the requested page.', comments: [{ id: '1', author: 'Demo User', text: 'Reproduced in the latest version.' }], commentsError: '', truncated: false }
export const requests = {
  'data.refresh': () => ({ ok: true as const }),
  'fields.read': () => ({}), 'fields.catalog': () => detail.customFields,
  'issues.selection.read': () => ({ id: null }), 'issues.selection.save': () => ({ ok: true as const }),
  'connection.read': () => connected, 'projects.list': () => projects, 'issues.list': () => issues, 'issues.detail': () => detail,
  'issues.subtasks': () => [{ ...issues.items[0], id: '44', title: 'Check redirect target', subtasks: 0 }],
  'project.bind': () => projects.items[0], 'view.save': () => ({ ok: true as const }),
}
