// =============================================================================
// Security: Authentication, Authorization, Tenant Context
// =============================================================================
// This module is the single source of truth for "who is asking, and for whom".
// Every API route MUST call `requireContext()` at the top.
// Every service-layer function MUST accept a `TenantContext` and NEVER read
// from a global. This makes cross-tenant data leakage structurally impossible.
//
// Auth priority (highest first):
//   1. API key (x-api-key header) — for integrations
//   2. JWT session cookie (jobrolo_session) — for browser users (PRODUCTION)
//   3. Demo mode (JOBROLO_DEMO=1) — DEV ONLY, auto-auths as first contractor owner
// =============================================================================

import { db } from '@/lib/db'
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getSessionCookie, verifySession } from './session'

export interface AuthUser {
  id: string
  contractorId: string
  name: string
  email: string
  avatar?: string | null
  role: string
  status: string
}

export interface TenantContext {
  contractorId: string
  contractor: {
    id: string
    name: string
    company: string | null
    plan: string
    subscriptionStatus?: string
    status: string
  }
  user: AuthUser | null // null when API key without user impersonation
  actor: string // for audit logs: 'user:email', 'api:prefix', 'system', 'ai'
  authMethod: 'session' | 'api_key' | 'system' | 'demo'
}

// Demo bypass: dev only. SECURITY: Crashes in production if JOBROLO_DEMO=1 is set.
const DEMO_MODE = process.env.JOBROLO_DEMO === '1'

// SECURITY: Demo mode must NEVER be active in production
if (process.env.NODE_ENV === 'production' && DEMO_MODE) {
  throw new Error('JOBROLO_DEMO cannot be enabled in production. Set JOBROLO_DEMO=0 or remove it.')
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function getContext(req: NextRequest): Promise<TenantContext | null> {
  // 1. API key auth (for integrations)
  const apiKey = req.headers.get('x-api-key')
  if (apiKey) {
    const ctx = await contextFromApiKey(apiKey, req)
    if (ctx) return ctx
  }

  // 2. JWT session cookie (PRODUCTION auth for browser users)
  const sessionToken = getSessionCookie(req)
  if (sessionToken) {
    const ctx = await contextFromSession(sessionToken)
    if (ctx) return ctx
  }

  // 3. Demo mode — DEV ONLY. Auto-auths as first contractor's owner.
  //    In production this requires JOBROLO_DEMO=1 to be explicitly set,
  //    which is a security risk and should only be used for staging/demo deployments.
  if (DEMO_MODE) {
    return await contextFromDemo()
  }

  return null
}

async function contextFromSession(token: string): Promise<TenantContext | null> {
  const payload = await verifySession(token)
  if (!payload) return null

  // Verify the user still exists and is active
  const user = await db.user.findUnique({
    where: { id: payload.sub },
    include: { contractor: true },
  })
  if (!user || user.status !== 'active' || user.deletedAt) return null
  if (!user.contractor || user.contractor.status !== 'active' || user.contractor.deletedAt) return null

  // TRIAL EXPIRY: If the contractor's trial has expired and they haven't upgraded,
  // block access to core app data. They can still access billing/settings pages.
  // (trialEndsAt is checked against current time — if expired, session is rejected)
  // Note: In dev/demo mode, trial check is skipped to avoid locking out dev users.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.JOBROLO_DEMO !== '1' &&
    user.contractor.trialEndsAt &&
    new Date(user.contractor.trialEndsAt) < new Date() &&
    ['trialing', 'expired'].includes(String((user.contractor as any).subscriptionStatus || 'trialing'))
  ) {
    console.warn(`[context] Trial expired for contractor ${user.contractorId} — blocking access`)
    await db.contractor.update({ where: { id: user.contractorId }, data: { subscriptionStatus: 'expired' } }).catch(() => null)
    return null
  }

  // SECURITY: Verify tokenVersion matches — if the user's tokenVersion was
  // incremented (e.g., on password reset), this session is invalid
  if (user.tokenVersion !== payload.tv) {
    return null
  }

  return {
    contractorId: user.contractorId,
    contractor: {
      id: user.contractor.id,
      name: user.contractor.name,
      company: user.contractor.company,
      plan: user.contractor.plan,
      subscriptionStatus: (user.contractor as any).subscriptionStatus,
      status: user.contractor.status,
    },
    user: {
      id: user.id,
      contractorId: user.contractorId,
      name: user.name,
      email: user.email,
      avatar: user.avatar ?? null,
      role: user.role,
      status: user.status,
    },
    actor: `user:${user.email}`,
    authMethod: 'session',
  }
}

async function contextFromApiKey(apiKey: string, req: NextRequest): Promise<TenantContext | null> {
  const keyHash = hashApiKey(apiKey)
  const record = await db.apiKey.findUnique({
    where: { keyHash },
    include: {
      contractor: true,
      user: { select: { id: true, contractorId: true, name: true, email: true, avatar: true, role: true, status: true } },
    },
  })
  if (!record || record.revokedAt || (record.expiresAt && record.expiresAt < new Date())) {
    return null
  }
  if (record.contractor.status !== 'active') return null

  db.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date(), lastUsedIp: getClientIp(req) },
  }).catch(() => {})

  return {
    contractorId: record.contractorId,
    contractor: {
      id: record.contractor.id,
      name: record.contractor.name,
      company: record.contractor.company,
      plan: record.contractor.plan,
      subscriptionStatus: (record.contractor as any).subscriptionStatus,
      status: record.contractor.status,
    },
    user: record.user ?? null,
    actor: `api:${record.keyPrefix}`,
    authMethod: 'api_key',
  }
}

async function contextFromDemo(): Promise<TenantContext | null> {
  const contractor = await db.contractor.findFirst({
    where: { status: 'active', deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  if (!contractor) return null
  const user = await db.user.findFirst({
    where: { contractorId: contractor.id, role: 'owner', status: 'active' },
  })
  return {
    contractorId: contractor.id,
    contractor: {
      id: contractor.id,
      name: contractor.name,
      company: contractor.company,
      plan: contractor.plan,
      subscriptionStatus: (contractor as any).subscriptionStatus,
      status: contractor.status,
    },
    user: user ? {
      id: user.id,
      contractorId: user.contractorId,
      name: user.name,
      email: user.email,
      avatar: user.avatar ?? null,
      role: user.role,
      status: user.status,
    } : null,
    actor: user ? `user:${user.email}` : 'system',
    authMethod: 'demo',
  }
}

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function requireContext(req: NextRequest): Promise<TenantContext> {
  const ctx = await getContext(req)
  if (!ctx) throw new UnauthorizedError('Authentication required')
  return ctx
}

export class UnauthorizedError extends Error {
  statusCode = 401
  constructor(message: string) { super(message) }
}

export class ForbiddenError extends Error {
  statusCode = 403
  constructor(message: string) { super(message) }
}

export class OnboardingIncompleteError extends ForbiddenError {
  redirectTo = '/'
  constructor(message = 'Open Jobrolo Command Center to finish setup.') { super(message) }
}

// withContext: wrap an API handler with auth + error handling
type Handler<T> = (req: NextRequest, ctx: TenantContext, ...args: any[]) => Promise<T>

export function withContext<T>(handler: Handler<T>) {
  return async (req: NextRequest, ...args: any[]): Promise<T | NextResponse> => {
    try {
      const ctx = await requireContext(req)
      return await handler(req, ctx, ...args)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: err.message }, { status: 401 })
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json(
          { error: err.message, redirectTo: err instanceof OnboardingIncompleteError ? err.redirectTo : undefined },
          { status: 403 },
        )
      }
      console.error('[withContext] error:', err)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}

// Role-based authorization
const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  manager: ['read', 'write', 'ai', 'finance', 'reports'],
  sales: ['read', 'write', 'ai', 'estimates'],
  crew: ['read', 'write', 'photos'],
  accounting: ['read', 'finance', 'invoices'],
}

// API key scopes — must be explicitly granted. No wildcard bypass.
const API_KEY_SCOPES: Record<string, string[]> = {
  // Default scopes for API keys — read-only by default
  default: ['read'],
  // Full access scope (must be explicitly set on the ApiKey record)
  full: ['read', 'write', 'ai', 'finance', 'reports', 'estimates', 'photos', 'invoices'],
}

export function can(ctx: TenantContext, permission: string): boolean {
  if (!ctx.user) {
    // API keys get scoped permissions, NOT wildcard access
    if (ctx.authMethod === 'api_key') {
      // For now, API keys have read-only access unless we add a scopes field
      // TODO: Add 'scopes' field to ApiKey model for per-key scope control
      const scopes = API_KEY_SCOPES.default
      return scopes.includes(permission) || scopes.includes('*')
    }
    return false
  }
  const perms = ROLE_PERMISSIONS[ctx.user.role] ?? []
  return perms.includes('*') || perms.includes(permission)
}

export function requirePermission(ctx: TenantContext, permission: string): void {
  if (!can(ctx, permission)) {
    throw new ForbiddenError(`Role '${ctx.user?.role ?? 'none'}' cannot ${permission}`)
  }
}

// Audit logging
export async function audit(
  ctx: TenantContext,
  action: string,
  resourceType: string,
  resourceId: string | null = null,
  detail: string | null = null,
  metadata: Record<string, unknown> | null = null,
  req: NextRequest | null = null,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        contractorId: ctx.contractorId,
        userId: ctx.user?.id ?? null,
        actor: ctx.actor,
        action,
        resourceType,
        resourceId,
        detail,
        metadataJson: metadata ? JSON.stringify(metadata) : null,
        ipAddress: req ? getClientIp(req) : null,
        userAgent: req?.headers.get('user-agent') ?? null,
      },
    })
  } catch (err) {
    console.error('[audit] failed:', err)
  }
}

// API key generation — uses crypto.randomBytes for cryptographic security
export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const random = randomBytes(32).toString('hex')
  const key = `jro_${random}`
  return {
    key,
    keyHash: hashApiKey(key),
    keyPrefix: key.slice(0, 12),
  }
}
