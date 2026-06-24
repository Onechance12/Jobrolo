import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { startCanvassingSession } from '@/lib/canvassing'

const LocationSchema = z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable()
const StartSchema = z.object({ title: z.string().optional().nullable(), territoryName: z.string().optional().nullable(), notes: z.string().optional().nullable(), location: LocationSchema })

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const sessions = await db.canvassingSession.findMany({
    where: { contractorId: ctx.contractorId, ...(sp.get('status') ? { status: sp.get('status')! } : {}) },
    orderBy: { startedAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ sessions })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = StartSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const session = await startCanvassingSession(ctx, parsed.data)
  return NextResponse.json({ session }, { status: 201 })
}
