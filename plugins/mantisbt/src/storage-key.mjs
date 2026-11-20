import { createHash } from 'node:crypto'

export function storageKey(namespace, ...parts) {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('base64url')
  return `${namespace}.v1.${hash}`
}
