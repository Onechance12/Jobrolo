import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { requireAnyRoleResponse } from '@/lib/security/permissions'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager'])
  if (roleErr) return roleErr

  const url = new URL(req.url)
  const month = url.searchParams.get('month')
  const start = month && /^\d{4}-\d{2}$/.test(month)
    ? new Date(`${month}-01T00:00:00.000Z`)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))

  const where = {
    contractorId: ctx.contractorId,
    createdAt: { gte: start, lt: end },
  }

  const [totals, byPurpose, recentFailures] = await Promise.all([
    db.aIUsageLog.aggregate({
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        imageCount: true,
        webSearchCalls: true,
        estimatedCost: true,
      },
    }),
    db.aIUsageLog.groupBy({
      by: ['purpose'],
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        imageCount: true,
        webSearchCalls: true,
        estimatedCost: true,
      },
    }),
    db.aIUsageLog.findMany({
      where: { ...where, success: false },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, purpose: true, provider: true, model: true, error: true, createdAt: true },
    }),
  ])

  return NextResponse.json({
    month: start.toISOString().slice(0, 7),
    estimatedCost: totals._sum.estimatedCost ?? 0,
    calls: totals._count._all,
    tokens: {
      input: totals._sum.inputTokens ?? 0,
      output: totals._sum.outputTokens ?? 0,
      total: totals._sum.totalTokens ?? 0,
    },
    imageAnalysisCount: totals._sum.imageCount ?? 0,
    webSearchCalls: totals._sum.webSearchCalls ?? 0,
    byPurpose: byPurpose.map(row => ({
      purpose: row.purpose,
      calls: row._count._all,
      estimatedCost: row._sum.estimatedCost ?? 0,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
      totalTokens: row._sum.totalTokens ?? 0,
      imageCount: row._sum.imageCount ?? 0,
      webSearchCalls: row._sum.webSearchCalls ?? 0,
    })),
    failuresCount: recentFailures.length,
    recentFailures,
  })
}
