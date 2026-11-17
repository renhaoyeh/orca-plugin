import * as source from './asana-source.mjs'
import * as api from './asana-api.mjs'
const project = item => ({ id: String(item.gid), name: item.name, workspaceId: item.workspaceGid || item.workspace || '' })
const task = item => ({
  id: item.gid, title: item.name, url: /^https:\/\/app\.asana\.com\//.test(item.url || '') ? item.url : '',
  status: item.completed ? 'Completed' : 'Open', assignee: item.assignee || '', assigneeId: item.assigneeGid || '',
  section: item.section || 'No section', due: item.due || '', subtasks: item.subtasks || 0,
  customFields: (item.customFields || []).map(field => ({ id: field.gid, name: field.name, type: field.type, displayValue: field.displayValue, color: field.value?.color || '' })),
  parent: item.parent && typeof item.parent === 'object' ? { id: item.parent.gid, title: item.parent.name } : null,
})
const id = value => { if (!/^\d+$/.test(String(value))) throw Error('Invalid Asana ID.'); return String(value) }
export function asanaClient(_kind, config, request = fetch) {
  const token = config.token
  return {
    async validate() { const me = (await api.getUser(token, 'me', {}, request)).data; if (!me?.gid) throw Error('Asana did not return a user.') },
    async projectInfo(gid) {
      const item = (await api.getProject(token, id(gid), { opt_fields: 'name,workspace.gid' }, request)).data
      if (!item || String(item.gid) !== String(gid)) throw Error('Asana project was not found.')
      return { id: String(item.gid), name: item.name || String(item.gid), workspaceId: String(item.workspace?.gid || '') }
    },
    async projects(_cursor = null, query = '') { return { items: (await source.searchProjects(token, query, request)).map(item => ({ ...project(item), workspaceName: item.workspace })), next: null } },
    async issues(gid, cursor = null, scope = 'mine') {
      gid = id(gid)
      if (scope === 'mine') {
        const workspace = await source.projectWorkspace(token, gid, request)
        if (!workspace) throw Error('Asana project has no workspace.')
        return { items: (await source.myProjectTasks(token, gid, workspace, request)).map(task), next: null }
      }
      const page = await source.projectTasksPage(token, gid, cursor, request)
      return { items: page.tasks.map(task), next: page.next }
    },
    async subtasks(gid) { return (await source.openSubtasks(token, id(gid), request)).map(task) },
    async detail(gid, projectId = null) {
      const item = await source.taskDetails(token, id(gid), projectId ? id(projectId) : null, request)
      if (!item || item.completed) throw Error('This task was completed or deleted in Asana.')
      let comments = [], commentsError = ''
      try { comments = await source.taskComments(token, gid, request) } catch { commentsError = 'Comments could not be loaded. Refresh to retry.' }
      return { ...task(item), description: item.notes.slice(0, 16000), comments: comments.slice(0, 30).map(item => ({ id: item.gid, author: item.author, text: item.text.slice(0, 1500), at: item.at })), commentsError,
        truncated: item.notes.length > 16000 || comments.length > 30 || comments.some(item => item.text.length > 1500) }
    },
  }
}
