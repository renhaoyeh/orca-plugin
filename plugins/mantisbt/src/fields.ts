import type { FieldLayout, FieldOption, FieldPreference, FieldSurface, PriorityColor } from './protocol'

const standardFields: FieldOption[] = [
  { id: 'status', name: 'Status' }, { id: 'projectName', name: 'Project' },
  { id: 'assignee', name: 'Assignee' }, { id: 'due', name: 'Due date' },
  { id: 'priority', name: 'Priority' }, { id: 'severity', name: 'Severity' },
  { id: 'category', name: 'Category' }, { id: 'resolution', name: 'Resolution' },
  { id: 'reproducibility', name: 'Reproducibility' }, { id: 'reporter', name: 'Reporter' },
  { id: 'viewStatus', name: 'Visibility' }, { id: 'createdAt', name: 'Created' },
  { id: 'updatedAt', name: 'Updated' }, { id: 'noteCount', name: 'Notes' },
  { id: 'attachmentCount', name: 'Attachments' }, { id: 'tags', name: 'Tags' },
  { id: 'subtasks', name: 'Subtasks' },
]
const defaultPriorityField = 'pm priority for cc4 & ic8'
const numberedPriorities = [
  ['未分類', '#596779'], ['待討論', '#7653a6'], ['緊急 (Urgent)', '#b42318'],
  ['高 (High)', '#a44a10'], ['中 (Normal)', '#3b62a5'],
  ['Release 前修改完成 (Fix before Release)', '#876000'], ['時間允許再修改 (Fix if available)', '#39704f'],
  ['保留 or 下版處理', '#596779'], ['FAQ or Help', '#236b78'], ['不處理', '#596779'],
  ['Content', '#236b78'], ['字串商品化', '#7653a6'], ['功能開發', '#3b62a5'],
] as const

export const pmPriorityOptions = numberedPriorities.map(([name], index) => `${String(index).padStart(2, '0')}. ${name}`)

export function isPmPriority(field: FieldOption) {
  return field.name.trim().toLowerCase() === defaultPriorityField
}

export function priorityKey(value: string) {
  const normalized = value.trim().toLowerCase()
  const code = /^(\d{1,2})(?:[.．、]|$)/.exec(normalized)?.[1]
  return code !== undefined && Number(code) < numberedPriorities.length ? code.padStart(2, '0') : normalized
}

export function priorityLabel(value: string) {
  const trimmed = value.trim()
  return /^\d{1,2}$/.test(trimmed) ? pmPriorityOptions[Number(trimmed)] ?? trimmed : trimmed
}

export function priorityColor(value: string, overrides: readonly PriorityColor[] = []) {
  const level = priorityKey(value)
  const override = overrides.find(entry => entry.value === level)
  if (override) return override.color
  if (/^\d{2}$/.test(level) && Number(level) < numberedPriorities.length) return numberedPriorities[Number(level)][1]
  if (/^(?:p0|urgent|critical|blocker|immediate)\b/.test(level) || /^(?:緊急|紧急|阻擋|阻挡)$/.test(level)) return '#b42318'
  if (/^(?:p1|high|major)\b/.test(level) || /^(?:高|重要|嚴重|严重)$/.test(level)) return '#a44a10'
  if (/^(?:p2|medium|normal)\b/.test(level) || /^(?:中|一般|普通)$/.test(level)) return '#3b62a5'
  if (/^(?:p[3-9]|low|minor)\b/.test(level) || /^(?:低|次要)$/.test(level)) return '#39704f'
  return '#596779'
}

export function fieldOptions(surface: FieldSurface, custom: FieldOption[], saved: FieldPreference[] = []) {
  const standard = surface === 'list' ? [{ id: 'id', name: 'ID' }, ...standardFields] : standardFields.filter(field => field.id !== 'subtasks' && field.id !== 'noteCount')
  const customFields = custom.map(field => ({ ...field, id: `custom:${field.id}` }))
  const defaults = surface === 'list'
    ? ['id', ...customFields.filter(isPmPriority).map(field => field.id), 'status', 'due', 'assignee']
    : [...standard, ...customFields].map(field => field.id)
  const fields = new Map([...standard, ...customFields].map(field => [field.id, field]))
  const preferences = new Map(saved.map(field => [field.id, field.visible]))
  const order = new Set([...preferences.keys(), ...defaults, ...fields.keys()])
  return Array.from(order).flatMap(id => {
    const field = fields.get(id)
    return field ? [{ ...field, visible: preferences.get(id) ?? defaults.includes(id) }] : []
  })
}

export function normalizeLayout(value: unknown): FieldLayout {
  const result: FieldLayout = {}
  if (!value || typeof value !== 'object') return result
  for (const surface of ['list', 'detail'] as const) {
    const entries = (value as FieldLayout)[surface]
    if (!Array.isArray(entries)) continue
    const unique = new Map<string, FieldPreference>()
    for (const field of entries) {
      if (field && typeof field.id === 'string' && typeof field.visible === 'boolean') {
        unique.set(field.id, { id: field.id, visible: field.visible })
      }
    }
    result[surface] = [...unique.values()]
  }
  const colors = (value as FieldLayout).priorityColors
  if (Array.isArray(colors)) {
    const unique = new Map<string, string>()
    for (const entry of colors) {
      if (typeof entry?.value !== 'string' || typeof entry.color !== 'string' || !/^#[\da-f]{6}$/i.test(entry.color)) continue
      const level = priorityKey(entry.value)
      if (level) unique.set(level, entry.color.toLowerCase())
    }
    if (unique.size) result.priorityColors = Array.from(unique, ([value, color]) => ({ value, color }))
  }
  return result
}
