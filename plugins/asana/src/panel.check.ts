import { defineCheck } from 'orca/testing'
import { requests, connected, projects } from './fixtures'
const bound = () => ({ ...connected, binding: projects.items[0] })
export default defineCheck({
  disconnected: { requests: { 'connection.read': () => ({ configured: false, url: '' }) } },
  projects: { requests },
  tasks: { requests: { ...requests, 'connection.read': bound } },
  empty: { requests: { ...requests, 'connection.read': bound, 'issues.list': () => ({ items: [], next: null }) } },
  denied: { requests: { ...requests, 'projects.list': () => { throw Error('Asana rejected this token. Replace it in Settings.') } } },
  more: { requests: { ...requests, 'connection.read': () => ({ ...bound(), tab: 'all' as const }), 'issues.list': () => ({ items: [{ id: '42', title: 'Fix login redirect', status: 'Open', assignee: 'Demo User', url: '', section: 'Doing' }], next: 'opaque-next' }) } },
})
