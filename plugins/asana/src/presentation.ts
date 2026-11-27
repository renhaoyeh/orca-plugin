type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
export function sectionTone(value: string): Tone {
  if (/done|complete|closed|已完成|已結案/i.test(value)) return 'success'
  if (/block|blocked|阻擋|受阻|卡住/i.test(value)) return 'danger'
  if (/review|test|\bqa\b|審核|測試|待確認/i.test(value)) return 'warning'
  if (/progress|doing|working|進行|處理中/i.test(value)) return 'accent'
  if (!value || /no section|backlog|todo|not started|待辦|未開始/i.test(value)) return 'neutral'
  return 'accent'
}
export function fieldTone(color = '', value = ''): Tone {
  if (/red|pink|orange-red/i.test(color)) return 'danger'
  if (/green|mint/i.test(color)) return 'success'
  if (/yellow|orange/i.test(color)) return 'warning'
  if (/blue|purple|indigo|violet/i.test(color)) return 'accent'
  return sectionTone(value)
}
export function dueTone(value: string, today = new Date()): Tone {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'neutral'
  const local = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-')
  return value < local ? 'danger' : value === local ? 'warning' : 'neutral'
}
export function dateLabel(value: string, locale?: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : value
}
export function activityDateLabel(value: string, locale?: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : value
}
export function validTimestamp(value: string) {
  return Number.isFinite(new Date(value).getTime())
}
