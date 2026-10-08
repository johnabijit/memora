const CACHE = 'memora-v43.1'
const ASSETS = ['./', './index.html', './styles.css?v=43.1', './app.js?v=43.1', './icon.svg', './manifest.webmanifest']
const assetPaths = new Set(ASSETS.map(path => new URL(path, self.location.href).pathname))

self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('memora-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  // Never cache sessions, private memories, API errors, audio streams or external data.
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return
  if (url.pathname.startsWith('/api/') || request.headers.has('range')) return
  if (!assetPaths.has(url.pathname) && request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && response.type === 'basic' && assetPaths.has(url.pathname)) {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(event.request)
        if (cached) return cached
        if (event.request.mode === 'navigate') return caches.match('./index.html')
        return Response.error()
      })
  )
})
