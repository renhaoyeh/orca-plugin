import type { Issue } from './protocol'

export type TaskRowNode = { issue: Issue; children: TaskRowNode[] }

export function taskRowsWithSubtasks(
  groups: Map<string, Issue[]>,
  subtasks: Map<string, Issue[]>,
  expandedSections: Map<string, boolean>,
  matchesFilter: (issue: Issue) => boolean,
) {
  const candidates = Array.from(groups, ([section, issues]) => expandedSections.get(section) ? issues : []).flat()
  const descendants = new Set<string>()
  function markDescendants(parentId: string, path: Set<string>) {
    for (const child of subtasks.get(parentId) || []) {
      if (!matchesFilter(child) || path.has(child.id)) continue
      descendants.add(child.id)
      const childPath = new Set(path)
      childPath.add(child.id)
      markDescendants(child.id, childPath)
    }
  }
  for (const issue of candidates) markDescendants(issue.id, new Set([issue.id]))

  const rendered = new Set<string>()
  function build(issue: Issue, path: Set<string>): TaskRowNode {
    const children: TaskRowNode[] = []
    for (const child of subtasks.get(issue.id) || []) {
      if (!matchesFilter(child) || path.has(child.id) || rendered.has(child.id)) continue
      rendered.add(child.id)
      const childPath = new Set(path)
      childPath.add(child.id)
      children.push(build(child, childPath))
    }
    return { issue, children }
  }

  const roots = new Map<string, TaskRowNode[]>()
  for (const [section, issues] of groups) {
    const sectionRoots: TaskRowNode[] = []
    if (expandedSections.get(section)) {
      for (const issue of issues) {
        if (descendants.has(issue.id) || rendered.has(issue.id)) continue
        rendered.add(issue.id)
        sectionRoots.push(build(issue, new Set([issue.id])))
      }
    } else {
      for (const issue of issues) if (!descendants.has(issue.id)) sectionRoots.push({ issue, children: [] })
    }
    roots.set(section, sectionRoots)
  }
  return roots
}
