export function requestCache<T>(maxAge = Infinity, capacity = 64) {
  const values = new Map<string, { data: T; expires: number }>()
  const pending = new Map<string, Promise<T>>()

  function get(key: string) {
    const entry = values.get(key)
    if (entry && entry.expires > Date.now()) return entry.data
    values.delete(key)
  }

  return {
    get,
    load(key: string, fetch: () => Promise<T>, shouldCache: (value: T) => boolean = () => true) {
      const cached = get(key)
      if (cached !== undefined) return Promise.resolve(cached)
      const active = pending.get(key)
      if (active) return active
      const request = fetch().then(value => {
        if (pending.get(key) === request && shouldCache(value)) {
          if (values.size >= capacity) values.delete(values.keys().next().value!)
          values.set(key, { data: value, expires: Date.now() + maxAge })
        }
        return value
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key)
      })
      pending.set(key, request)
      return request
    },
    forget(key: string) { values.delete(key); pending.delete(key) },
    clear() { values.clear(); pending.clear() },
  }
}
