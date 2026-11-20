import { createHash } from 'node:crypto'

export function fieldStorageKey(url, project) {
  const hash = createHash('sha256').update(JSON.stringify([url, project])).digest('base64url')
  return `fields.v1.${hash}`
}
