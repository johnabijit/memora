export function safeStorage(name) {
  const fallback = new Map()
  return {
    getItem(key) {
      try { return window[name].getItem(key) ?? fallback.get(key) ?? null }
      catch { return fallback.get(key) ?? null }
    },
    setItem(key, value) {
      fallback.set(key, String(value))
      try { window[name].setItem(key, String(value)) } catch {}
    },
    removeItem(key) {
      fallback.delete(key)
      try { window[name].removeItem(key) } catch {}
    }
  }
}

export async function fetchApi(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), ...options })
  const isJson = response.headers.get('content-type')?.includes('application/json')
  if (!isJson) throw new Error('Memora service is unavailable. Please try again.')
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Memora service is temporarily unavailable.')
  return data
}
