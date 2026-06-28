import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export const DEV_BRIDGE_TOKEN_ENV = 'CODY_BRIDGE_TOKEN'

export function devBridgeTokenFromRequest(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return req.headers.get('x-cody-bridge-token')?.trim() ?? ''
}

export function isDevBridgeAuthorized(req: NextRequest) {
  const configured = process.env[DEV_BRIDGE_TOKEN_ENV]?.trim()
  const supplied = devBridgeTokenFromRequest(req)
  if (!configured || !supplied) return false
  const configuredBuffer = Buffer.from(configured)
  const suppliedBuffer = Buffer.from(supplied)
  if (configuredBuffer.length !== suppliedBuffer.length) return false
  return timingSafeEqual(configuredBuffer, suppliedBuffer)
}

export function devBridgeUnauthorizedResponse() {
  const configured = process.env[DEV_BRIDGE_TOKEN_ENV]
  return NextResponse.json(
    {
      error: configured
        ? 'Unauthorized'
        : `Dev bridge is not configured. Set ${DEV_BRIDGE_TOKEN_ENV} in the environment.`,
    },
    { status: configured ? 401 : 503 },
  )
}

export function requireDevBridge(req: NextRequest) {
  if (!isDevBridgeAuthorized(req)) return devBridgeUnauthorizedResponse()
  return null
}

export function safeJson<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function safeText(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export function boundedLimit(value: string | null, fallback = 50, max = 200) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(max, Math.floor(parsed)))
}

export function minutesAgo(value: string | null, fallback = 60) {
  const parsed = Number(value)
  const minutes = Number.isFinite(parsed) ? Math.max(1, Math.min(60 * 24 * 7, Math.floor(parsed))) : fallback
  return new Date(Date.now() - minutes * 60 * 1000)
}

export function storageDescriptor(path: string | null | undefined) {
  if (!path) return null
  if (path.startsWith('r2://')) {
    const [, rest = ''] = path.split('r2://')
    const slash = rest.indexOf('/')
    return {
      provider: 'r2',
      bucket: slash >= 0 ? rest.slice(0, slash) : rest,
      key: slash >= 0 ? rest.slice(slash + 1) : '',
      basename: rest.split('/').filter(Boolean).at(-1) ?? null,
    }
  }
  if (path.startsWith('s3://')) {
    const [, rest = ''] = path.split('s3://')
    const slash = rest.indexOf('/')
    return {
      provider: 's3',
      bucket: slash >= 0 ? rest.slice(0, slash) : rest,
      key: slash >= 0 ? rest.slice(slash + 1) : '',
      basename: rest.split('/').filter(Boolean).at(-1) ?? null,
    }
  }
  return {
    provider: 'local',
    path,
    basename: path.split('/').filter(Boolean).at(-1) ?? null,
  }
}
