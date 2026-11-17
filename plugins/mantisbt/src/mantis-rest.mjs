import { client, normalizeServer } from './api.mjs'
export const normalizeUrl = normalizeServer
export function mantisRequest(connection, path, request = fetch) {
  const [resource, query = ''] = path.split('?')
  return client('mantisbt', connection, request).read(resource, Object.fromEntries(new URLSearchParams(query)))
}
