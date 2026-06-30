/* Jobrolo PWA service worker.
 *
 * Conservative by design:
 * - caches public shell/static assets only
 * - does not cache API responses
 * - does not cache authenticated HTML pages
 * - falls back to /offline for navigations when the network is unavailable
 */

const CACHE_VERSION = 'jobrolo-pwa-v1'
const SHELL_CACHE = `${CACHE_VERSION}:shell`
const STATIC_CACHE = `${CACHE_VERSION}:static`

const SHELL_ASSETS = [
  '/offline',
  '/manifest.webmanifest',
  '/logo.png',
  '/logo.svg',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('jobrolo-pwa-') && !key.startsWith(CACHE_VERSION))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin
}

function isApiRequest(requestUrl) {
  return requestUrl.pathname.startsWith('/api/')
}

function isStaticAssetRequest(request) {
  return ['style', 'script', 'worker', 'image', 'font'].includes(request.destination)
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response && response.ok) {
    const cache = await caches.open(STATIC_CACHE)
    cache.put(request, response.clone()).catch(() => undefined)
  }
  return response
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request)
  } catch {
    const fallback = await caches.match('/offline')
    return fallback || new Response('Jobrolo is offline. Reconnect to continue.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return
  if (!isSameOrigin(url)) return
  if (isApiRequest(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (isStaticAssetRequest(request)) {
    event.respondWith(cacheFirstStatic(request))
  }
})
