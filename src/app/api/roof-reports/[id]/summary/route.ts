import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { generateRoofReportSummary, getRoofReportWorkspace } from '@/lib/roof-reports'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  try {
    await generateRoofReportSummary(ctx, id)
    const workspace = await getRoofReportWorkspace(ctx, id)
    return NextResponse.json({ workspace })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not generate summary' }, { status: 400 })
  }
}
