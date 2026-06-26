import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { cancelJob } from '@/lib/jobs/queue'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : ''
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const cancelled = await cancelJob(jobId, ctx.contractorId)
  return NextResponse.json({ cancelled })
}

