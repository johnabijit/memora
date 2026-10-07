const CACHE = 'memora-v2'
const ASSETS = ['./', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest', './icon.svg']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)))
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)))
})
