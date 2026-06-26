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

function stableStringify(value: unknown): string {
  if (typeof value === 'undefined') return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function approvalKey(payload: any) {
  if (payload?.approvalKey) return String(payload.approvalKey)
  if (payload?.toolName) return `${payload.toolName}:${stableStringify(payload.args ?? {})}`
  return null
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
      const replayContext = { ...(payload.toolContext ?? {}) }
      delete replayContext.approved
      delete replayContext.approvalActionRequestId
      delete replayContext.trustedDirectExecution
      delete replayContext.userId
      delete replayContext.userRole
      replayResult = await executeTool(payload.toolName, payload.args ?? {}, ctx.contractorId, {
        ...replayContext,
        userId: ctx.user?.id,
        userRole: ctx.user?.role,
        approved: true,
        approvalActionRequestId: id,
      })
      await db.actionRequest.update({
        where: { id },
        data: {
          status: (replayResult as any)?.success ? 'completed' : 'approved',
          completedAt: (replayResult as any)?.success ? new Date() : undefined,
          payloadJson: JSON.stringify({ ...payload, replayResult }),
        },
      }).catch(() => null)
      if ((replayResult as any)?.success) {
        const key = approvalKey(payload)
        if (key) {
          const pending = await db.actionRequest.findMany({
            where: { contractorId: ctx.contractorId, type: 'tool_approval', status: { in: ['pending', 'needs_approval'] }, NOT: { id } },
            select: { id: true, payloadJson: true },
            take: 50,
          }).catch(() => [])
          const duplicateIds = pending.filter(other => approvalKey(safeJson(other.payloadJson)) === key).map(other => other.id)
          if (duplicateIds.length) {
            await db.actionRequest.updateMany({ where: { contractorId: ctx.contractorId, id: { in: duplicateIds } }, data: { status: 'rejected', rejectedAt: new Date() } }).catch(() => null)
            await db.inboxItem.updateMany({ where: { contractorId: ctx.contractorId, actionRequestId: { in: duplicateIds } }, data: { status: 'actioned', actionedAt: new Date() } }).catch(() => null)
          }
        }
      }
    }

    return NextResponse.json({ actionRequest, replayResult })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Decision failed' }, { status: 403 })
  }
}
