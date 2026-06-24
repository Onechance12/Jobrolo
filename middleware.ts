import { NextRequest, NextResponse } from 'next/server'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function middleware(req: NextRequest) {
  if (!WRITE_METHODS.has(req.method)) return NextResponse.next()
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()

  // API-key integrations authenticate separately and are not browser-cookie CSRF targets.
  if (req.headers.get('x-api-key')) return NextResponse.next()

  const hasSessionCookie = Boolean(req.cookies.get('jobrolo_session')?.value)
  if (!hasSessionCookie) return NextResponse.next()

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const appOrigin = req.nextUrl.origin
  const allowedOrigin = origin ? origin === appOrigin : (referer ? referer.startsWith(`${appOrigin}/`) : process.env.NODE_ENV !== 'production')

  if (!allowedOrigin) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
