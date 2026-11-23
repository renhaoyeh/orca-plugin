import * as source from './mantis-source.mjs'
import * as api from './mantis-api.mjs'
const id = value => { if (!/^\d+$/.test(String(value))) throw Error('Invalid MantisBT ID.'); return String(value) }
const project = item => ({ id: String(item.gid), name: item.name, workspaceId: String(item.gid), workspaceName: item.workspace || '' })
const maxImageBytes = 8 * 1024 * 1024
const imageType = /^image\/(png|jpeg|gif|webp|avif|bmp)$/
const imageMime = file => String(file.content_type ?? '').split(';')[0].trim().toLowerCase()
const validFiles = attachments => Array.isArray(attachments) ? attachments.filter(file =>
  /^\d+$/.test(String(file?.id)) && typeof file.filename === 'string') : []
function imageFiles(attachments) {
  return validFiles(attachments).filter(file => imageType.test(imageMime(file)) &&
    Number(file.size) > 0 && Number(file.size) <= maxImageBytes)
}
const imageList = attachments => imageFiles(attachments).map(file => ({ id: String(file.id), name: file.filename }))
const attachmentList = attachments => validFiles(attachments).map(file => ({ id: String(file.id), name: file.filename,
  image: imageType.test(imageMime(file)) && Number(file.size) > 0 && Number(file.size) <= maxImageBytes,
  at: file.created_at || file.date_submitted || null, authorId: String(file.reporter?.id ?? file.user_id ?? ''),
  author: file.reporter?.real_name || file.reporter?.name || (file.user_id ? `User ${file.user_id}` : '') }))
function issue(item) {
  const { gid, name, notes, comments, customFields, parent, reproductionSteps, attachments, ...metadata } = item
  return { ...metadata, id: gid, title: name, status: item.section, assignee: item.assignee || '', due: item.due || '',
    customFields: (customFields || []).map(field => ({ id: field.gid, name: field.name, type: field.type, displayValue: field.displayValue })),
    parent: parent && typeof parent === 'object' ? { id: parent.gid, title: parent.name } : null }
}
export function mantisClient(_kind, config, request = fetch) {
  async function projectRecord(gid) {
    const body = await api.getProject(config, gid, request)
    const item = body.projects?.find(item => String(item.id) === gid) || body.project
    if (!item || String(item.id) !== gid) throw Error('MantisBT project not found.')
    return item
  }
  return {
    async image(issueId, fileId) {
      issueId = id(issueId)
      fileId = id(fileId)
      const issue = (await api.getIssue(config, issueId, request)).issues?.find(item => String(item.id) === issueId)
      const visibleFiles = [...imageFiles(issue?.attachments), ...(issue?.notes || []).flatMap(note => imageFiles(note.attachments))]
      if (!visibleFiles.some(file => String(file.id) === fileId)) throw Error('Image unavailable.')
      const body = await api.getIssueFile(config, issueId, fileId, request)
      const file = imageFiles(body.files).find(file => String(file.id) === fileId)
      if (!file || typeof file.content !== 'string' || file.content.length > Math.ceil(maxImageBytes / 3) * 4 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(file.content)) throw Error('Image unavailable.')
      return `data:${imageMime(file)};base64,${file.content}`
    },
    validate: () => source.validateConnection(config, request),
    async projectFields(gid) {
      const item = await projectRecord(id(gid))
      return (item.custom_fields || []).map(entry => {
        const options = entry.possible_values ?? entry.field?.possible_values
        const values = typeof options === 'string' ? options.split('|') : Array.isArray(options) ? options : []
        return {
          id: String(entry.field?.id ?? entry.id), name: entry.field?.name || entry.name || 'Custom field',
          choices: values.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean),
        }
      })
    },
    async projects(_cursor = null, query = '') { return { items: (await source.searchProjects(config, query, request)).map(project), next: null } },
    async projectInfo(gid) {
      gid = id(gid)
      const item = await projectRecord(gid)
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
      const attachments = attachmentList(item.attachments)
      return { ...issue(item), description: item.notes.slice(0, 16000), reproductionSteps: item.reproductionSteps, commentsError: '',
        attachments,
        comments: comments.map(note => ({ id: note.gid, author: note.author, text: note.text, at: note.at,
          images: imageList(note.attachments), attachments: attachmentList(note.attachments) }))
          .filter(note => note.text || note.attachments.length),
        truncated: item.notes.length > 16000 }
    },
  }
}
