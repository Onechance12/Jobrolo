import type { NextResponse } from 'next/server'
import { NextResponse as NR } from 'next/server'
import type { TenantContext } from './context'

export type JobroloRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'project_manager'
  | 'coordinator'
  | 'sales'
  | 'crew'
  | 'supplier'
  | 'finance'
  | 'customer'
  | string

const ROLE_ALIASES: Record<string, string> = {
  pm: 'project_manager',
  projectmanager: 'project_manager',
  field: 'crew',
  installer: 'crew',
  subcontractor: 'crew',
  accounting: 'finance',
  bookkeeper: 'finance',
  purchasing: 'supplier',
  vendor: 'supplier',
}

export function normalizeRole(role?: string | null): string {
  const raw = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return ROLE_ALIASES[raw] || raw || 'anonymous'
}

export function hasAnyRole(ctx: TenantContext, allowed: string[]): boolean {
  const role = normalizeRole(ctx.user?.role)
  if (role === 'owner') return true
  return allowed.map(normalizeRole).includes(role)
}

export function isOwnerAdminManager(ctx: TenantContext): boolean {
  return hasAnyRole(ctx, ['owner', 'admin', 'manager', 'project_manager'])
}

export function isOfficeRole(ctx: TenantContext): boolean {
  return hasAnyRole(ctx, ['owner', 'admin', 'manager', 'project_manager', 'coordinator', 'finance'])
}

export function forbidden(message = 'Forbidden'): NextResponse {
  return NR.json({ error: message }, { status: 403 })
}

export function requireAnyRoleResponse(ctx: TenantContext, roles: string[]): NextResponse | null {
  return hasAnyRole(ctx, roles) ? null : forbidden()
}

export function canDecideAction(ctx: TenantContext, requestedRole?: string | null): boolean {
  const role = normalizeRole(ctx.user?.role)
  if (['owner', 'admin', 'manager'].includes(role)) return true
  const requested = normalizeRole(requestedRole)
  if (!requested) return false
  if (requested === 'project_manager' && ['project_manager', 'coordinator'].includes(role)) return true
  if (requested === 'coordinator' && ['project_manager', 'coordinator'].includes(role)) return true
  return role === requested
}
