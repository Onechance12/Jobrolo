import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { decideActionRequest } from '@/lib/field-copilot'
import { canDecideAction } from '@/lib/security/permissions'

const DecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().max(5000).optional().nullable(),
})

function safeJson(value: string | null | undefined) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const reqRecord = await db.actionRequest.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!reqRecord) return NextResponse.json({ error: 'Action request not found' }, { status: 404 })
  if (!canDecideAction(ctx, reqRecord.requestedRole)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = DecisionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  try {
    const actionRequest = await decideActionRequest(ctx, id, parsed.data.decision, parsed.data.notes)
    if (!actionRequest) return NextResponse.json({ error: 'Action request not found' }, { status: 404 })

    let replayResult: unknown = null
    const payload = safeJson(reqRecord.payloadJson)
    if (parsed.data.decision === 'approved' && payload?.toolName) {
      const { executeTool } = await import('@/lib/agent/tools-v2')
      replayResult = await executeTool(payload.toolName, payload.args ?? {}, ctx.contractorId, {
        ...(payload.toolContext ?? {}),
        userId: ctx.user?.id,
        approved: true,
      })
      await db.actionRequest.update({
        where: { id },
        data: {
          status: (replayResult as any)?.success ? 'completed' : 'approved',
          completedAt: (replayResult as any)?.success ? new Date() : undefined,
          payloadJson: JSON.stringify({ ...payload, replayResult }),
        },
      }).catch(() => null)
    }

    return NextResponse.json({ actionRequest, replayResult })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Decision failed' }, { status: 403 })
  }
}
