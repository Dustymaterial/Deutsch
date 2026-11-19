const CACHE_NAME = 'deutsch-shell-v4'
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/app-icon.svg',
  '/deck-template.csv',
  '/deck-template.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('deutsch-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

const isPage = (response) => response?.ok && !response.redirected &&
  response.headers.get('content-type')?.toLowerCase().includes('text/html')

async function readCached(key) {
  try { return await (await caches.open(CACHE_NAME)).match(key) }
  catch { return undefined }
}

async function remember(key, response) {
  try { await (await caches.open(CACHE_NAME)).put(key, response) }
  catch { /* A storage failure must not discard a valid network response. */ }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/optional-voice/') || request.cache === 'no-store') return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (isPage(response)) {
          event.waitUntil(remember('/', response.clone()))
          return response
        }
        const cached = await readCached('/')
        return isPage(cached) ? cached : response
      } catch {
        const cached = await readCached('/')
        return isPage(cached) ? cached : Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cached = await readCached(request)
    if (cached?.ok) return cached
    const response = await fetch(request)
    if (response.ok) event.waitUntil(remember(request, response.clone()))
    return response
  })())
})
