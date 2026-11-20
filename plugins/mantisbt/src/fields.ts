import type { FieldLayout, FieldOption, FieldPreference, FieldSurface } from './protocol'

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
const listDefaults = ['id', 'status', 'assignee', 'category', 'severity', 'priority', 'updatedAt', 'due', 'noteCount', 'subtasks']

export function fieldOptions(surface: FieldSurface, custom: FieldOption[], saved: FieldPreference[] = []) {
  const standard = surface === 'list' ? [{ id: 'id', name: 'ID' }, ...standardFields] : standardFields.filter(field => field.id !== 'subtasks' && field.id !== 'noteCount')
  const defaults = surface === 'list' ? listDefaults : [...standard.map(field => field.id), ...custom.map(field => `custom:${field.id}`)]
  const fields = new Map([...standard, ...custom.map(field => ({ ...field, id: `custom:${field.id}` }))].map(field => [field.id, field]))
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
  return result
}
