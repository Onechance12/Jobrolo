import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { getFieldBriefing } from '@/lib/field-copilot'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id: projectId } = await params
  const sp = new URL(req.url).searchParams
  const briefing = await getFieldBriefing(ctx, {
    projectId,
    appointmentId: sp.get('appointmentId'),
    fieldVisitId: sp.get('fieldVisitId'),
    mode: sp.get('mode'),
  })
  if (!briefing) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  return NextResponse.json({ briefing })
}
