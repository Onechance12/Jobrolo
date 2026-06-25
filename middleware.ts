import { NextRequest, NextResponse } from 'next/server'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function normalizeOrigin(value?: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return null
  }
}

function firstHeaderValue(value?: string | null): string | null {
  return value?.split(',')[0]?.trim() || null
}

function getForwardedOrigin(req: NextRequest): string | null {
  const forwardedHost = firstHeaderValue(req.headers.get('x-forwarded-host'))
  const forwardedProto = firstHeaderValue(req.headers.get('x-forwarded-proto')) || 'https'
  if (!forwardedHost) return null
  return normalizeOrigin(`${forwardedProto}://${forwardedHost}`)
}

function getConfiguredOrigins(req: NextRequest): Set<string> {
  const origins = new Set<string>()

  const nextUrlOrigin = normalizeOrigin(req.nextUrl.origin)
  if (nextUrlOrigin) origins.add(nextUrlOrigin)

  const forwardedOrigin = getForwardedOrigin(req)
  if (forwardedOrigin) origins.add(forwardedOrigin)

  const appOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL)
  if (appOrigin) origins.add(appOrigin)

  // Render's first live prototype host. Keep this explicit instead of allowing all
  // onrender.com origins.
  origins.add('https://jobrolo.onrender.com')

  return origins
}

function isAllowedBrowserOrigin(req: NextRequest): boolean {
  const allowedOrigins = getConfiguredOrigins(req)
  const origin = normalizeOrigin(req.headers.get('origin'))

  if (origin) {
    return allowedOrigins.has(origin)
  }

  const referer = req.headers.get('referer')
  if (referer) {
    const refererOrigin = normalizeOrigin(referer)
    return Boolean(refererOrigin && allowedOrigins.has(refererOrigin))
  }

  return process.env.NODE_ENV !== 'production'
}

export function middleware(req: NextRequest) {
  if (!WRITE_METHODS.has(req.method)) return NextResponse.next()
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()

  // API-key integrations authenticate separately and are not browser-cookie CSRF targets.
  if (req.headers.get('x-api-key')) return NextResponse.next()

  const hasSessionCookie = Boolean(req.cookies.get('jobrolo_session')?.value)
  if (!hasSessionCookie) return NextResponse.next()

  if (!isAllowedBrowserOrigin(req)) {
    console.warn('[middleware] Invalid request origin', {
      origin: req.headers.get('origin'),
      referer: req.headers.get('referer'),
      host: req.headers.get('host'),
      forwardedHost: req.headers.get('x-forwarded-host'),
      forwardedProto: req.headers.get('x-forwarded-proto'),
      nextUrlOrigin: req.nextUrl.origin,
      configuredAppOrigin: normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
    })
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
