const MAX_BODY_BYTES = 64 * 1024

async function readJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request is too large'), { status: 413 })
  }
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw Object.assign(new Error('Use application/json'), { status: 415 })
  }
  const reader = request.body?.getReader()
  const chunks = []
  let size = 0
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw Object.assign(new Error('Request is too large'), { status: 413 })
      }
      chunks.push(value)
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch {
    throw Object.assign(new Error('Invalid JSON request'), { status: 400 })
  }
}

export function pagesHandler(handler) {
  return async ({ request, env = {} }) => {
    let statusCode = 200
    let body = null
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
    const res = {
      get statusCode() { return statusCode },
      set statusCode(value) { statusCode = value },
      setHeader(key, value) { headers.set(key, String(value)) },
      end(value = null) { body = value; return this }
    }
    try {
      const url = new URL(request.url)
      const req = {
        method: request.method, query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(request.headers),
        body: request.method === 'POST' ? await readJson(request) : undefined
      }
      await handler(req, res, env)
      if (statusCode === 405 && !headers.has('Allow')) headers.set('Allow', handler.allow || 'GET')
      return new Response(request.method === 'HEAD' || [204, 304].includes(statusCode) ? null : body, {
        status: statusCode, headers
      })
    } catch (error) {
      console.error('Memora API request failed', error.name || 'Error')
      return Response.json({ error: error.status ? error.message : 'Service temporarily unavailable' }, {
        status: error.status || 502, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      })
    }
  }
}
