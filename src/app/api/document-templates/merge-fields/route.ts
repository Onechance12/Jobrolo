import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { buildProjectMergeData } from '@/lib/contractor-profile'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const customerId = searchParams.get('customerId')
  const mergeContext = await buildProjectMergeData({ contractorId: ctx.contractorId, projectId, customerId })
  return NextResponse.json({ fields: Object.keys(mergeContext.data).sort(), preview: mergeContext.data, profile: mergeContext.profile })
}
