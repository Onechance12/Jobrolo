import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { getRoofReportWorkspace } from '@/lib/roof-reports'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const workspace = await getRoofReportWorkspace(ctx, id)
  if (!workspace) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  return NextResponse.json(workspace)
}
