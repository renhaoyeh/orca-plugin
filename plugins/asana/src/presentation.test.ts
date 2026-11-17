import { assert, test } from 'orca/testing'
import { sectionTone, fieldTone, dueTone } from './presentation'
test('Section and Asana enum colors keep meaningful accessible text and semantic tones', () => {
  assert.equal(sectionTone('In progress'), 'accent')
  assert.equal(sectionTone('Blocked'), 'danger')
  assert.equal(sectionTone('已完成'), 'success')
  assert.equal(sectionTone('In QA'), 'warning')
  assert.equal(sectionTone('No section'), 'neutral')
  assert.equal(fieldTone('dark-red', 'High'), 'danger')
  assert.equal(fieldTone('light-green', 'Approved'), 'success')
})
test('due date colors use local calendar dates, with today distinct from overdue', () => {
  const today = new Date(2027, 0, 2, 23, 30)
  assert.equal(dueTone('2027-01-01', today), 'danger')
  assert.equal(dueTone('2027-01-02', today), 'warning')
  assert.equal(dueTone('2027-01-03', today), 'neutral')
  assert.equal(dueTone('', today), 'neutral')
})
