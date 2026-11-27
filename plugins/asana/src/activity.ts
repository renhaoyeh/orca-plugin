type Comment = { id: string; author: string; text: string; at?: string | null }
type Activity = { id: string; subtype: string; author: string; text: string; fallback: string; at?: string | null }
export type TimelineItem = (Comment & { kind: 'comment' }) | (Activity & { kind: 'activity' })

const fallbackKeys: Record<string, string> = {
  assigned: 'Assignment changed',
  due_date_changed: 'Due date changed',
  section_changed: 'Section changed',
  marked_complete: 'Task completed',
  marked_incomplete: 'Task reopened',
}

export function activityLabel(subtype: string, fallback: string, translate: (key: string) => string) {
  const key = Object.hasOwn(fallbackKeys, subtype) ? fallbackKeys[subtype] : undefined
  return key ? translate(key) : fallback || subtype.replace(/[_-]+/g, ' ')
}

export function mergeTaskTimeline(comments: Comment[], activities: Activity[] = []): TimelineItem[] {
  return [
    ...comments.map((item, order) => ({ ...item, kind: 'comment' as const, order })),
    ...activities.map((item, order) => ({ ...item, kind: 'activity' as const, order: comments.length + order })),
  ].sort((a, b) => {
    const left = a.at ? Date.parse(a.at) : Number.NaN
    const right = b.at ? Date.parse(b.at) : Number.NaN
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right
    if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1
    return a.order - b.order
  })
}
