import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { getPropertyResearchRun } from '@/lib/property-research'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const result = await getPropertyResearchRun(ctx, id)
  if (!result) return NextResponse.json({ error: 'Property research run not found' }, { status: 404 })
  return NextResponse.json(result)
}
