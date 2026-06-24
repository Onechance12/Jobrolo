import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { createRoofReportPdf, getRoofReportWorkspace } from '@/lib/roof-reports'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  try {
    const result = await createRoofReportPdf(ctx, id)
    const workspace = await getRoofReportWorkspace(ctx, id)
    return NextResponse.json({ ...result, workspace })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not create PDF' }, { status: 400 })
  }
}
