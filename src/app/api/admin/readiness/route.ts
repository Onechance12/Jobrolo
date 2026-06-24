import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { getProductionReadinessReport } from '@/lib/production-readiness'

function canAdmin(role?: string | null) {
  return ['owner', 'admin', 'manager'].includes(String(role ?? '').toLowerCase())
}

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!canAdmin(ctx.user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const report = await getProductionReadinessReport()
  return NextResponse.json(report, { status: report.status === 'blocked' ? 503 : 200 })
}
