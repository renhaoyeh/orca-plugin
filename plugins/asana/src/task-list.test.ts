import { assert, test } from 'orca/testing'
import type { Issue } from './protocol'
import { taskRowsWithSubtasks } from './task-list'

function task(id: string, section: string): Issue {
  return { id, title: `Task ${id}`, status: 'Open', assignee: '', url: '', section, subtasks: 1 }
}

test('nested cached subtasks move as a complete visible tree without leaving empty section rows', () => {
  const a = task('A', 'Alpha')
  const b = task('B', 'Beta')
  const c = task('C', 'Beta')
  const groups = new Map([['Alpha', [a]], ['Beta', [b, c]]])
  const children = new Map([['A', [b]], ['B', [c]]])
  const rows = taskRowsWithSubtasks(groups, children, new Map([['Alpha', true], ['Beta', true]]), () => true)
  const tree = rows.get('Alpha')![0]
  assert.equal(tree.issue.id, 'A')
  assert.equal(tree.children[0].issue.id, 'B')
  assert.equal(tree.children[0].children[0].issue.id, 'C')
  assert.deepEqual(rows.get('Beta'), [])
})

test('filtered or collapsed parents do not suppress independently visible project rows', () => {
  const a = task('A', 'Alpha')
  const b = task('B', 'Beta')
  const groups = new Map([['Alpha', [a]], ['Beta', [b]]])
  const children = new Map([['A', [b]]])
  const collapsed = taskRowsWithSubtasks(groups, children, new Map([['Alpha', false], ['Beta', true]]), () => true)
  assert.equal(collapsed.get('Beta')?.[0].issue.id, 'B')
  const filtered = taskRowsWithSubtasks(new Map([['Beta', [b]]]), children, new Map([['Beta', true]]), () => true)
  assert.equal(filtered.get('Beta')?.[0].issue.id, 'B')
})
