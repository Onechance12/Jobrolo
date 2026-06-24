import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { getContractorOcrReviewQueue } from '@/lib/project-context'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const limit = Number(url.searchParams.get('limit') ?? '50')
  const queue = await getContractorOcrReviewQueue(ctx.contractorId, {
    projectId,
    limit: Number.isFinite(limit) ? limit : 50,
  })
  return NextResponse.json(queue)
}
