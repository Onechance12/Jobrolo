import fs from 'node:fs'
import path from 'node:path'

function readProjectFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

export function assertPwaContracts() {
  const manifest = JSON.parse(readProjectFile('public/manifest.webmanifest')) as {
    name?: string
    short_name?: string
    start_url?: string
    scope?: string
    display?: string
    icons?: Array<{ src?: string; purpose?: string }>
  }

  if (manifest.name !== 'Jobrolo') throw new Error('PWA manifest must name the app Jobrolo')
  if (manifest.short_name !== 'Jobrolo') throw new Error('PWA manifest must include short_name Jobrolo')
  if (!manifest.start_url?.startsWith('/')) throw new Error('PWA manifest must use a same-origin start_url')
  if (manifest.scope !== '/') throw new Error('PWA manifest must keep app scope at /')
  if (manifest.display !== 'standalone') throw new Error('PWA manifest must request standalone display')
  if (!manifest.icons?.some(icon => icon.src === '/logo-512.png' && icon.purpose?.includes('maskable'))) {
    throw new Error('PWA manifest must include a maskable app icon')
  }

  const serviceWorker = readProjectFile('public/sw.js')
  const requiredSnippets = [
    "const CACHE_VERSION = 'jobrolo-pwa-v2'",
    "const SHELL_ASSETS = [",
    'const APP_SHELL_ROUTES = new Set',
    "'/offline'",
    "'/manifest.webmanifest'",
    "'/logo-192.png'",
    "'/logo-512.png'",
    "if (isApiRequest(url)) return",
    "request.mode === 'navigate'",
    "networkFirstAppShell(request)",
    "cacheFirstStatic(request)",
    "staleWhileRevalidateStatic(request)",
  ]

  for (const snippet of requiredSnippets) {
    if (!serviceWorker.includes(snippet)) {
      throw new Error(`PWA service worker is missing required contract snippet: ${snippet}`)
    }
  }

  if (!serviceWorker.includes("requestUrl.pathname.startsWith('/api/')")) {
    throw new Error('PWA service worker must keep API routes network-only')
  }

  if (!serviceWorker.includes('if (isApiRequest(url)) return')) {
    throw new Error('PWA fetch handler must bypass API requests before caching logic')
  }

  if (!serviceWorker.includes('isAppShellRoute(url) ? networkFirstAppShell(request) : networkOnlyNavigation(request)')) {
    throw new Error('PWA navigation caching must be limited to explicit app shell routes')
  }

  if (serviceWorker.includes("APP_SHELL_ROUTES.add('/api")) {
    throw new Error('PWA app shell routes must not include API routes')
  }

  for (const shellRoute of ["'/'", "'/field-copilot'", "'/canvassing'"]) {
    if (!serviceWorker.includes(shellRoute)) {
      throw new Error(`PWA service worker must include core app shell route ${shellRoute}`)
    }
  }

  const layout = readProjectFile('src/app/layout.tsx')
  if (!layout.includes("manifest: '/manifest.webmanifest'")) {
    throw new Error('Root metadata must reference the PWA manifest')
  }
  if (!layout.includes('<PwaRegister />')) {
    throw new Error('Root layout must register the PWA service worker client component')
  }
}

if (require.main === module) {
  assertPwaContracts()
  console.log('pwa contracts passed')
}
