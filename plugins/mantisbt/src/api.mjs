const text = value => typeof value === 'string' ? value : ''
const mebibyte = 1024 * 1024
export function normalizeServer(value) {
  try {
    const url = new URL(String(value).trim().replace(/\/+$/, '').replace(/\/api\/rest(?:\/index\.php)?$/i, ''))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error()
    return url.href.replace(/\/+$/, '')
  } catch { throw Error('Enter a MantisBT server URL, such as https://mantis.example.com.') }
}
export function connection(_kind, input) {
  const token = text(input?.token).trim()
  if (!token || token.length > 8192 || /[\x00-\x20\x7f]/.test(token)) throw Error('Enter a valid API token.')
  return { token, url: normalizeServer(input.url) }
}
export function client(_kind, saved, fetcher = fetch) {
  const config = connection('mantisbt', saved), base = config.url + '/api/rest'
  let bearer = false
  async function get(resource, query = {}) {
    const url = new URL(base + resource)
    if (!resource.startsWith('/') || /[\\?#]/.test(resource) || url.origin !== new URL(base).origin || !url.pathname.startsWith(new URL(base).pathname + '/')) throw Error('Invalid MantisBT API path.')
    // MantisBT returns the entire accessible project tree with project metadata in one response.
    const isIssueFile = /^\/issues\/\d+\/files\/\d+$/.test(resource)
    const limitMiB = resource === '/projects' ? 32 : isIssueFile ? 12 : 4
    for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
    async function send() {
      try { return await fetcher(url.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json', Authorization: bearer ? `Bearer ${config.token}` : config.token } }) }
      catch { throw Error('Could not reach the API. Check the server address, network and TLS certificate.') }
    }
    let response = await send()
    if (!bearer && [401, 403].includes(response.status)) { await response.body?.cancel(); bearer = true; response = await send() }
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 404) throw Object.assign(Error('Issue or project not found.'), { status: 404 })
      if ([401, 403].includes(response.status)) throw Object.assign(Error('API token rejected or access denied. Check the token and account permissions.'), { unauthorized: true })
      if (response.status === 429) throw Error('API rate limit reached. Wait before refreshing.')
      if (response.status >= 300 && response.status < 400) throw Error('The API redirected the request. Enter the final server URL; tokens are never forwarded to redirects.')
      throw Error(`API request failed (${response.status}).`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw Error('The MantisBT API returned an empty response.')
    const decoder = new TextDecoder()
    let raw = '', size = 0
    while (true) {
      const part = await reader.read().catch(() => {
        throw Error('Could not finish reading the MantisBT API response. Check the network and try again.')
      })
      if (part.done) break
      size += part.value.byteLength
      if (size > limitMiB * mebibyte) {
        void reader.cancel().catch(() => {})
        throw Error(`The MantisBT API response exceeded ${limitMiB} MiB.`)
      }
      raw += decoder.decode(part.value, { stream: true })
    }
    raw += decoder.decode()
    if (!raw.trim()) throw Error('The MantisBT API returned an empty response.')
    let body
    try { body = JSON.parse(raw) }
    catch {
      if (/^\s*</.test(raw)) throw Error('The MantisBT API returned HTML. Check the server URL and any proxy or sign-in page in front of the API.')
      throw Error('The server did not return valid API JSON.')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('The MantisBT API returned an unexpected JSON response.')
    return body
  }
  return { read: get }
}
