import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { renderRoofReportHtml } from '@/lib/field-ops'
import { getContractorProfile } from '@/lib/contractor-profile'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const report = await db.roofReport.findFirst({
    where: { id, contractorId: ctx.contractorId },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const profile = await getContractorProfile(ctx.contractorId)
  return new NextResponse(renderRoofReportHtml(report, profile), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
