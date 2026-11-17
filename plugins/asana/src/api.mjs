// Transport only. Asana domain rules live in the original herdr-zed source projection.
export function connection(_kind, input) {
  const token = typeof input?.token === 'string' ? input.token.trim() : ''
  if (!token || token.length > 8192 || /[\x00-\x20\x7f]/.test(token)) throw Error('Enter a valid API token.')
  return { token, url: 'https://app.asana.com' }
}
export function client(_kind, saved, fetcher = fetch) {
  const { token } = connection('asana', saved)
  return { async read(resource, query = {}) {
    const url = new URL('https://app.asana.com/api/1.0' + resource)
    if (typeof resource !== 'string' || !resource.startsWith('/') || url.origin !== 'https://app.asana.com' || !url.pathname.startsWith('/api/1.0/')) throw Error('Invalid Asana API path.')
    for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
    let response
    try {
      response = await fetcher(url.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
    } catch { throw Error('Could not reach Asana. Check the network and TLS certificate.') }
    if (!response.ok) {
      await response.body?.cancel()
      if ([401, 403].includes(response.status)) throw Object.assign(Error('Asana rejected the token or denied access. Replace the token in Settings.'), { unauthorized: response.status === 401 })
      if (response.status === 404) throw Object.assign(Error('Item not found.'), { status: 404 })
      if (response.status === 429) throw Error('Asana rate limit reached. Wait before refreshing.')
      if (response.status >= 300 && response.status < 400) throw Error('Asana redirected the request. Tokens are never forwarded to redirects.')
      throw Error(`Asana API request failed (${response.status}).`)
    }
    const reader = response.body?.getReader(), decoder = new TextDecoder()
    let raw = '', size = 0
    try {
      if (!reader) throw Error()
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 4 * 1024 * 1024) throw Error()
        raw += decoder.decode(part.value, { stream: true })
      }
      raw += decoder.decode()
      const body = JSON.parse(raw)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error()
      return body
    } catch { await reader?.cancel().catch(() => {}); throw Error('Asana did not return valid API JSON, or the response was too large.') }
  } }
}
