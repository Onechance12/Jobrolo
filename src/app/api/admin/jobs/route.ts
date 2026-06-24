import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { requireAnyRoleResponse } from '@/lib/security/permissions'
import { processQueuedAgentJobs } from '@/lib/jobs/queue'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager'])
  if (roleErr) return roleErr
  const status = new URL(req.url).searchParams.get('status') ?? undefined
  const jobs = await db.agentJob.findMany({
    where: { contractorId: ctx.contractorId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, type: true, status: true, priority: true, heartbeat: true, error: true, workspaceId: true, chatId: true, createdAt: true, startedAt: true, completedAt: true, updatedAt: true },
  })
  const counts = await db.agentJob.groupBy({ by: ['status'], where: { contractorId: ctx.contractorId }, _count: { _all: true } }).catch(() => [])
  return NextResponse.json({ jobs, counts })
}

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager'])
  if (roleErr) return roleErr
  const body = await req.json().catch(() => ({}))
  const limit = Number(body.limit || 5)
  const result = await processQueuedAgentJobs(limit)
  return NextResponse.json(result)
}
