import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { requireAnyRoleResponse } from '@/lib/security/permissions'
import { getStorageConfig, storageHealthCheck } from '@/lib/storage'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager'])
  if (roleErr) return roleErr

  try {
    const result = await storageHealthCheck()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[storage] health failed:', err)
    return NextResponse.json({
      ...getStorageConfig(),
      canWrite: false,
      canRead: false,
      canDelete: false,
      error: err instanceof Error ? err.message : 'Storage health check failed',
      timestamp: new Date().toISOString(),
    }, { status: 503 })
  }
}
