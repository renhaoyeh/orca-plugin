// Orca transport adapter only. Domain/API projections are copied from herdr-zed.
import { client } from './api.mjs'
export function asanaRequest(token, resource, request = fetch) {
  const url = new URL('https://app.asana.com/api/1.0' + resource)
  if (url.origin !== 'https://app.asana.com' || !url.pathname.startsWith('/api/1.0/')) throw Error('Invalid Asana API path.')
  return client('asana', { token }, request).read(url.pathname.slice('/api/1.0'.length), Object.fromEntries(url.searchParams))
}
