import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const jobId = new URL(req.url).searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const job = await db.agentJob.findUnique({ where: { id: jobId } })
  if (!job || job.contractorId !== ctx.contractorId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({
    status: job.status,
    heartbeat: job.heartbeat,
    thinking: job.thinkingJson ? JSON.parse(job.thinkingJson) : [],
    result: job.outputJson ? JSON.parse(job.outputJson) : null,
    error: job.error,
  })
}
