// =============================================================================
// Session management — JWT in httpOnly cookies
// =============================================================================
// SECURITY: SESSION_SECRET is REQUIRED in production. No fallbacks.
// Tokens are signed with jose (HS256). The JWT payload contains:
//   { sub: userId, cid: contractorId, email, role, tv: tokenVersion, iat, exp }
//
// Cookies:
//   - jobrolo_session: httpOnly, secure (in prod), sameSite=lax, 24h expiry
//   - Path=/ so it's sent on every request
//
// Session invalidation: tokenVersion (tv) in the JWT is compared against the
// user's tokenVersion in the DB. Incrementing the user's tokenVersion
// invalidates all existing sessions (used on password reset, role change, etc.)
// =============================================================================

import { SignJWT, jwtVerify } from 'jose'
import type { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'

const SESSION_COOKIE = 'jobrolo_session'
const SESSION_TTL_SECONDS = 24 * 60 * 60 // 24 hours (was 30 days — too long for insurance data)

// SECURITY: Require SESSION_SECRET in production. No fallbacks.
function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET is required in production. Generate with: openssl rand -hex 32')
    }
    // Dev-only fallback — clearly marked, never used in prod
    console.warn('[session] WARNING: SESSION_SECRET not set — using insecure dev fallback. DO NOT use in production.')
    return new TextEncoder().encode('jobrolo-dev-only-secret-not-for-production-use')
  }
  return new TextEncoder().encode(secret)
}

export interface SessionPayload {
  sub: string        // userId
  cid: string        // contractorId
  email: string
  role: string
  name: string
  tv: number         // tokenVersion — for session invalidation
  iat?: number
  exp?: number
}

export async function issueSession(payload: Omit<SessionPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret())
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    return {
      sub: payload.sub as string,
      cid: payload.cid as string,
      email: payload.email as string,
      role: payload.role as string,
      name: payload.name as string,
      tv: (payload.tv as number) ?? 0,
      iat: payload.iat,
      exp: payload.exp,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers — work on both NextRequest (incoming) and NextResponse (outgoing)
// ---------------------------------------------------------------------------

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export function getSessionCookie(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE)?.value
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE

// Generate a cryptographically secure session secret
export function generateSessionSecret(): string {
  return randomBytes(32).toString('hex')
}
