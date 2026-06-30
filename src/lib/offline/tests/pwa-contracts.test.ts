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
  if (!manifest.icons?.some(icon => icon.src === '/logo.png' && icon.purpose?.includes('maskable'))) {
    throw new Error('PWA manifest must include a maskable app icon')
  }

  const serviceWorker = readProjectFile('public/sw.js')
  const requiredSnippets = [
    "const SHELL_ASSETS = [",
    "'/offline'",
    "'/manifest.webmanifest'",
    "if (isApiRequest(url)) return",
    "request.mode === 'navigate'",
    "cacheFirstStatic(request)",
  ]

  for (const snippet of requiredSnippets) {
    if (!serviceWorker.includes(snippet)) {
      throw new Error(`PWA service worker is missing required contract snippet: ${snippet}`)
    }
  }

  if (/cache\.put\(request,\s*response\.clone\(\)\)/.test(serviceWorker) && !serviceWorker.includes('isStaticAssetRequest(request)')) {
    throw new Error('PWA service worker may cache non-static responses')
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
