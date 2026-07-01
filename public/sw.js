/* Jobrolo PWA service worker.
 *
 * Maximized app-shell behavior:
 * - aggressively caches static assets
 * - caches known app shell routes with network-first fallback
 * - keeps /api/* network-only so private tenant data never becomes stale cache truth
 * - falls back to /offline when a route has never been cached on this device
 */

const CACHE_VERSION = 'jobrolo-pwa-v4'
const SHELL_CACHE = `${CACHE_VERSION}:shell`
const STATIC_CACHE = `${CACHE_VERSION}:static`
const ROUTE_CACHE = `${CACHE_VERSION}:routes`

const SHELL_ASSETS = [
  '/offline',
  '/manifest.webmanifest',
  '/logo.png',
  '/logo-192.png',
  '/logo-512.png',
]

const APP_SHELL_ROUTES = new Set([
  '/',
  '/canvassing',
  '/field-copilot',
  '/invite',
  '/login',
  '/onboarding',
  '/reset-password',
  '/settings/company',
  '/settings/notifications',
  '/signup',
  '/templates',
  '/templates/intake',
])

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

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin
}

function isApiRequest(requestUrl) {
  return requestUrl.pathname.startsWith('/api/')
}

function normalizePath(pathname) {
  if (pathname !== '/' && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

function isAppShellRoute(requestUrl) {
  return APP_SHELL_ROUTES.has(normalizePath(requestUrl.pathname))
}

function isStaticAssetRequest(request, requestUrl) {
  return requestUrl.pathname.startsWith('/_next/static/')
    || requestUrl.pathname === '/logo.png'
    || requestUrl.pathname === '/logo-192.png'
    || requestUrl.pathname === '/logo-512.png'
    || requestUrl.pathname === '/manifest.webmanifest'
    || ['style', 'script', 'worker', 'image', 'font'].includes(request.destination)
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

async function staleWhileRevalidateStatic(request) {
  const cached = await caches.match(request)
  const fetchAndCache = fetch(request)
    .then(response => {
      if (response && response.ok) {
        caches.open(STATIC_CACHE)
          .then(cache => cache.put(request, response.clone()))
          .catch(() => undefined)
      }
      return response
    })

  return cached || fetchAndCache
}

async function networkFirstAppShell(request) {
  const cache = await caches.open(ROUTE_CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => undefined)
    }
    return response
  } catch {
    const cached = await cache.match(request)
      || await cache.match('/')
      || await caches.match('/offline')

    return cached || new Response('Jobrolo is offline. Reconnect to continue.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

async function networkOnlyNavigation(request) {
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
    event.respondWith(isAppShellRoute(url) ? networkFirstAppShell(request) : networkOnlyNavigation(request))
    return
  }

  if (isStaticAssetRequest(request, url)) {
    const shouldPreferCachedAsset = request.destination === 'font'
    event.respondWith(shouldPreferCachedAsset ? cacheFirstStatic(request) : staleWhileRevalidateStatic(request))
  }
})
