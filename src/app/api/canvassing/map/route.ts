import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { getCanvassingMap } from '@/lib/canvassing'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const map = await getCanvassingMap(ctx, {
    sessionId: sp.get('sessionId'),
    status: sp.get('status'),
    includeConverted: sp.get('includeConverted') === '1' || sp.get('includeConverted') === 'true',
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
  })
  return NextResponse.json(map)
}
