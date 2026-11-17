import { assert, test } from 'orca/testing'
import { statusTone, priorityTone, dueTone } from './presentation'
import type { Issue } from './protocol'
test('Mantis status tones follow its own status names and priorities, not Asana project Sections', () => {
  const item = { id: '42', title: 'Issue', status: 'Assigned', assignee: '', url: '' } as Issue
  assert.equal(statusTone({ ...item, statusName: 'new' }), 'danger')
  assert.equal(statusTone({ ...item, statusName: 'feedback' }), 'warning')
  assert.equal(statusTone({ ...item, statusName: 'resolved' }), 'success')
  assert.equal(priorityTone(50), 'danger')
  assert.equal(priorityTone(40), 'warning')
  assert.equal(priorityTone(30), 'neutral')
})
test('due date colors use local calendar dates, with today distinct from overdue', () => {
  const today = new Date(2027, 0, 2, 23, 30)
  assert.equal(dueTone('2027-01-01', today), 'danger')
  assert.equal(dueTone('2027-01-02', today), 'warning')
  assert.equal(dueTone('2027-01-03', today), 'neutral')
  assert.equal(dueTone('', today), 'neutral')
})
