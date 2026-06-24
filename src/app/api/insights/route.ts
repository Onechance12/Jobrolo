import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { runOperationsRadar } from '@/lib/radar'
export const runtime = 'nodejs'
export const maxDuration = 60

// GET /api/insights — list insights grouped by status
export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const statusFilter = sp.get('status')

  const where: any = { contractorId: ctx.contractorId }
  if (statusFilter) {
    where.status = statusFilter
  } else {
    // By default, show everything except dismissed/resolved
    where.status = { notIn: ['dismissed', 'resolved'] }
  }

  const insights = await db.insight.findMany({
    where,
    orderBy: [
      { status: 'asc' },
      { confidence: 'desc' },
      { createdAt: 'desc' },
    ],
    take: 100,
  })

  // Group by status for the UI
  const grouped: Record<string, typeof insights> = {}
  for (const insight of insights) {
    if (!grouped[insight.status]) grouped[insight.status] = []
    grouped[insight.status].push(insight)
  }

  return NextResponse.json({ insights, grouped })
}

// POST /api/insights — run radar scan
export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const result = await runOperationsRadar(ctx.contractorId)
  return NextResponse.json({ success: true, ...result })
}

// PATCH /api/insights — update insight status (feedback)
export async function PATCH(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const { insightId, status, feedback } = await req.json()
  if (!insightId || !status) return NextResponse.json({ error: 'insightId and status required' }, { status: 400 })

  const insight = await db.insight.findUnique({ where: { id: insightId } })
  if (!insight || insight.contractorId !== ctx.contractorId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.insight.update({
    where: { id: insightId },
    data: {
      status,
      feedback: feedback ?? null,
      resolvedAt: (status === 'resolved' || status === 'handled') ? new Date() : insight.resolvedAt,
      dismissedAt: status === 'dismissed' ? new Date() : insight.dismissedAt,
    },
  })

  return NextResponse.json({ success: true })
}
