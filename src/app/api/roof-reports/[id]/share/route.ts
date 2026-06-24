import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { shareRoofReport } from '@/lib/roof-reports'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  try {
    const result = await shareRoofReport(ctx, id)
    return NextResponse.json({ shareToken: result.shareToken, shareUrl: result.shareUrl, report: result.report })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })
  }
}
