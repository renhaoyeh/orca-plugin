import * as source from './mantis-source.mjs'
import * as api from './mantis-api.mjs'
const id = value => { if (!/^\d+$/.test(String(value))) throw Error('Invalid MantisBT ID.'); return String(value) }
const project = item => ({ id: String(item.gid), name: item.name, workspaceId: String(item.gid), workspaceName: item.workspace || '' })
function issue(item) {
  const { gid, name, notes, comments, customFields, parent, ...metadata } = item
  return { ...metadata, id: gid, title: name, status: item.section, assignee: item.assignee || '', due: item.due || '',
    customFields: (customFields || []).map(field => ({ id: field.gid, name: field.name, type: field.type, displayValue: field.displayValue })),
    parent: parent && typeof parent === 'object' ? { id: parent.gid, title: parent.name } : null }
}
export function mantisClient(_kind, config, request = fetch) {
  return {
    validate: () => source.validateConnection(config, request),
    async projects(_cursor = null, query = '') { return { items: (await source.searchProjects(config, query, request)).map(project), next: null } },
    async projectInfo(gid) {
      gid = id(gid)
      const body = await api.getProject(config, gid, request)
      const item = body.projects?.find(item => String(item.id) === gid) || body.project
      if (!item || String(item.id) !== gid) throw Error('MantisBT project not found.')
      return project({ gid, name: item.name })
    },
    /** @param {string | null} cursor */
    async issues(gid, cursor = null, tab = 'mine') {
      gid = id(gid)
      if (cursor !== null && (!/^\d+$/.test(String(cursor)) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) < 1)) throw Error('Invalid issues cursor.')
      if (tab === 'mine') return { items: (await source.myProjectTasks(config, gid, gid, request)).map(issue), next: null }
      const page = await source.projectTasksPage(config, gid, cursor, request)
      return { items: page.tasks.map(issue), next: page.next ? String(page.next) : null }
    },
    async subtasks(gid) { return (await source.openSubtasks(config, id(gid), request)).map(issue) },
    async detail(gid) {
      const item = await source.taskDetails(config, id(gid), null, request)
      if (!item || item.completed) throw Error('This issue was resolved or deleted in MantisBT.')
      const comments = item.comments || []
      return { ...issue(item), description: item.notes.slice(0, 16000), commentsError: '',
        comments: comments.slice(0, 30).map(note => ({ id: note.gid, author: note.author, text: note.text.slice(0, 1500), at: note.at })),
        truncated: item.notes.length > 16000 || comments.length > 30 || comments.some(note => note.text.length > 1500) }
    },
  }
}
