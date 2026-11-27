import { assert, test } from 'orca/testing'
import { activityLabel, mergeTaskTimeline } from './activity'
import { localeOf, translate as translateMessage } from './i18n'
import { activityDateLabel, validTimestamp } from './presentation'

test('merges comments and system stories chronologically with stable ties and missing dates last', () => {
  const timeline = mergeTaskTimeline([
    { id: 'comment-2', author: 'A', text: 'second', at: '2026-01-02T00:00:00.000Z' },
    { id: 'comment-1', author: 'A', text: 'first', at: '2026-01-01T00:00:00.000Z' },
  ], [
    { id: 'activity-1', subtype: 'assigned', author: 'B', text: '', fallback: 'Assigned', at: '2026-01-02T00:00:00.000Z' },
    { id: 'activity-2', subtype: 'section_changed', author: 'B', text: '', fallback: 'Section Changed', at: null },
  ])
  assert.deepEqual(timeline.map(item => item.id), ['comment-1', 'comment-2', 'activity-1', 'activity-2'])
  assert.deepEqual(timeline.map(item => item.kind), ['comment', 'comment', 'activity', 'activity'])
})

test('localizes known empty-story fallbacks and keeps unknown subtype fallback honest', () => {
  const keys: string[] = []
  const translate = (key: string) => { keys.push(key); return `localized:${key}` }
  assert.equal(activityLabel('due_date_changed', 'Due Date Changed', translate), 'localized:Due date changed')
  assert.equal(activityLabel('new_system_event', 'New System Event', translate), 'New System Event')
  assert.equal(activityLabel('constructor', 'Constructor event', translate), 'Constructor event')
  assert.deepEqual(keys, ['Due date changed'])
  assert.equal(activityLabel('due_date_changed', 'Due Date Changed', key => translateMessage(key, localeOf('zh-TW'))), '\u5230\u671f\u65e5\u5df2\u8b8a\u66f4')
  assert.equal(activityLabel('section_changed', 'Section Changed', key => translateMessage(key, localeOf('zh-CN'))), '\u5206\u533a\u5df2\u66f4\u6539')
})

test('activity timestamps include localized time and preserve malformed values', () => {
  const first = activityDateLabel('2026-06-08T09:05:00.000Z', 'en-US')
  const second = activityDateLabel('2026-06-08T09:45:00.000Z', 'en-US')
  assert.notEqual(first, second)
  assert.match(first, /\d{1,2}:05/)
  assert.match(second, /\d{1,2}:45/)
  assert.equal(activityDateLabel('not a timestamp', 'en-US'), 'not a timestamp')
  assert.equal(validTimestamp('2026-06-08T09:05:00.000Z'), true)
  assert.equal(validTimestamp('not a timestamp'), false)
})
