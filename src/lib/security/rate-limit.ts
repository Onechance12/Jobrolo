// =============================================================================
// Rate Limiting — in-memory token bucket per (contractorId, route, ip).
// In production this should be backed by Redis; this implementation handles
// single-instance deployments and degrades gracefully in serverless.
// =============================================================================

// NOTE: This rate limiter uses in-memory state. In serverless environments
// (Vercel, Replit autoscale) each cold start resets the buckets.
// Set RATE_LIMIT_ENABLED=false to disable entirely in environments where
// this gives false confidence. For production, replace with Redis.
const ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false'

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

interface RateLimitOptions {
  // Maximum tokens in the bucket
  capacity: number
  // Tokens added per second
  refillRate: number
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  capacity: 20,
  refillRate: 2, // 2 per second after burst
}

const ROUTE_LIMITS: Record<string, RateLimitOptions> = {
  '/api/chat': { capacity: 10, refillRate: 0.5 }, // 10 burst, 1 per 2s sustained
  '/api/public/entry-chat': { capacity: 8, refillRate: 0.08 }, // public lobby chat: 8 burst, ~5/min sustained
  '/api/workspaces/[id]/chat': { capacity: 10, refillRate: 0.5 },
  '/api/upload': { capacity: 20, refillRate: 1 },
  '/api/tts': { capacity: 5, refillRate: 0.2 }, // 5 burst, 1 per 5s
  '/api/documents/[id]': { capacity: 60, refillRate: 5 },
  // Auth routes — strict limits to prevent brute force
  '/api/auth/login': { capacity: 5, refillRate: 0.0056 }, // 5 burst, 1 per 3 min (20/hr)
  '/api/auth/signup': { capacity: 3, refillRate: 0.0028 }, // 3 burst, 1 per 6 min (10/hr)
  '/api/auth/phone/start': { capacity: 4, refillRate: 0.0056 }, // 4 burst, 1 per 3 min
  '/api/auth/phone/verify': { capacity: 6, refillRate: 0.0056 }, // 6 burst, 1 per 3 min
  '/api/auth/reset-password/request': { capacity: 3, refillRate: 0.0056 }, // 3 burst, 1 per 3 min
  '/api/auth/reset-password/confirm': { capacity: 5, refillRate: 0.0056 }, // 5 burst, 1 per 3 min
  '/api/company-phone-numbers/search': { capacity: 8, refillRate: 0.033 }, // 8 burst, ~2/min sustained
  '/api/company-phone-numbers/provision': { capacity: 2, refillRate: 0.0017 }, // 2 burst, ~1/10min
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetAt: number
  retryAfter: number // seconds
}

export function rateLimit(
  key: string,
  route: string,
): RateLimitResult {
  if (!ENABLED) return { ok: true, remaining: 999, resetAt: Date.now() + 60000, retryAfter: 0 }
  const opts = ROUTE_LIMITS[route] ?? DEFAULT_OPTIONS
  const now = Date.now()
  const bucketKey = `${route}:${key}`
  let bucket = buckets.get(bucketKey)

  if (!bucket) {
    bucket = { tokens: opts.capacity, lastRefill: now }
    buckets.set(bucketKey, bucket)
  }

  // Refill tokens based on elapsed time
  const elapsedSec = (now - bucket.lastRefill) / 1000
  const refilled = Math.min(opts.capacity, bucket.tokens + elapsedSec * opts.refillRate)
  bucket.tokens = refilled
  bucket.lastRefill = now

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return {
      ok: true,
      remaining: Math.floor(bucket.tokens),
      resetAt: now + ((opts.capacity - bucket.tokens) / opts.refillRate) * 1000,
      retryAfter: 0,
    }
  }

  const retryAfter = Math.ceil((1 - bucket.tokens) / opts.refillRate)
  return {
    ok: false,
    remaining: 0,
    resetAt: now + retryAfter * 1000,
    retryAfter,
  }
}

// Cleanup old buckets periodically (every 5 minutes)
let lastCleanup = Date.now()
function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < 5 * 60 * 1000) return
  lastCleanup = now
  const cutoff = now - 30 * 60 * 1000 // remove buckets idle for 30+ min
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefill < cutoff) buckets.delete(key)
  }
}
cleanup()

// ---------------------------------------------------------------------------
// Auth-specific rate limiting — per-IP, for login/signup/reset routes
// ---------------------------------------------------------------------------

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function rateLimitByIp(req: NextRequest, route: string): NextResponse | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'

  const result = rateLimit(ip, route)
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': result.retryAfter.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': result.resetAt.toString(),
        },
      }
    )
  }
  return null
}
