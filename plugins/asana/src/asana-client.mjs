import * as source from './asana-source.mjs'
import * as api from './asana-api.mjs'
import { Buffer } from 'node:buffer'
const project = item => ({ id: String(item.gid), name: item.name, workspaceId: item.workspaceGid || item.workspace || '' })
const task = item => ({
  id: item.gid, title: item.name, url: /^https:\/\/app\.asana\.com\//.test(item.url || '') ? item.url : '',
  status: item.completed ? 'Completed' : 'Open', assignee: item.assignee || '', assigneeId: item.assigneeGid || '',
  section: item.section || '', due: item.due || '', subtasks: item.subtasks || 0,
  customFields: (item.customFields || []).map(field => ({ id: field.gid, name: field.name, type: field.type, displayValue: field.displayValue, color: field.value?.color || '' })),
  parent: item.parent && typeof item.parent === 'object' ? { id: item.parent.gid, title: item.parent.name } : null,
})
const id = value => { if (!/^\d+$/.test(String(value))) throw Error('Invalid Asana ID.'); return String(value) }
async function taskImages(token, gid, request) {
  const images = []
  let offset
  do {
    const page = await api.listAttachments(token, gid, {
      offset, limit: 50, opt_fields: 'name,resource_subtype,download_url',
    }, request)
    for (const file of page.data) {
      if (file.resource_subtype !== 'asana' || !/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name)) continue
      if (typeof file.download_url !== 'string' || !/^https:\/\//i.test(file.download_url)) continue
      images.push({ id: String(file.gid), name: file.name, url: file.download_url })
      if (images.length === 24) return images
    }
    offset = page.next_page?.offset
  } while (offset)
  return images
}
export function asanaClient(_kind, config, request = fetch) {
  const token = config.token
  return {
    async image(gid) {
      const file = (await api.getAttachment(token, id(gid), { opt_fields: 'resource_subtype,download_url,size' }, request)).data
      const maxBytes = 8 * 1024 * 1024
      if (file?.resource_subtype !== 'asana' || file.size > maxBytes ||
          typeof file.download_url !== 'string' || !file.download_url.startsWith('https://')) throw Error('Image unavailable.')
      const response = await request(file.download_url, { signal: AbortSignal.timeout(15000) })
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || ''
      if (!response.ok || !response.body || !/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime) ||
          Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel()
        throw Error('Image unavailable.')
      }
      const chunks = []
      let size = 0
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxBytes) {
            await reader.cancel()
            throw Error('Image unavailable.')
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`
    },
    async validate() { const me = (await api.getUser(token, 'me', {}, request)).data; if (!me?.gid) throw Error('Asana did not return a user.') },
    async projectInfo(gid) {
      const item = (await api.getProject(token, id(gid), { opt_fields: 'name,workspace.gid' }, request)).data
      if (!item || String(item.gid) !== String(gid)) throw Error('Asana project was not found.')
      return { id: String(item.gid), name: item.name || String(item.gid), workspaceId: String(item.workspace?.gid || '') }
    },
    async projects(_cursor = null, query = '') { return { items: (await source.searchProjects(token, query, request)).map(item => ({ ...project(item), workspaceName: item.workspace })), next: null } },
    /** @param {string | null} cursor */
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
    /** @param {string | null} projectId */
    async detail(gid, projectId = null) {
      const item = await source.taskDetails(token, id(gid), projectId ? id(projectId) : null, request)
      if (!item || item.completed) throw Error('This task was completed or deleted in Asana.')
      let comments = [], commentsError = ''
      const imagesRequest = taskImages(token, gid, request).catch(() => [])
      try { comments = await source.taskComments(token, gid, request) } catch { commentsError = 'Comments could not be loaded. Refresh to retry.' }
      return { ...task(item), images: await imagesRequest, description: item.notes.slice(0, 16000),
        descriptionHtml: item.htmlNotes.length <= 64_000 && item.notes.length <= 16_000 ? item.htmlNotes : '',
        comments: comments.slice(0, 30).map(item => ({ id: item.gid, author: item.author, text: item.text.slice(0, 1500), at: item.at })), commentsError,
        truncated: item.notes.length > 16000 || comments.length > 30 || comments.some(item => item.text.length > 1500) }
    },
  }
}
