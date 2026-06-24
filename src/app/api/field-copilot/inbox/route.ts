import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { listCopilotInbox } from '@/lib/field-copilot'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const inbox = await listCopilotInbox(ctx, {
    role: sp.get('role'),
    projectId: sp.get('projectId'),
    status: sp.get('status'),
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
  })
  return NextResponse.json(inbox)
}
