import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { createCanvassingLead } from '@/lib/canvassing'
import { db } from '@/lib/db'

const LocationSchema = z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable()
const LeadSchema = z.object({
  sessionId: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  homeownerName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  location: LocationSchema,
  metadata: z.record(z.string(), z.any()).optional().nullable(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const leads = await db.canvassingLead.findMany({
    where: {
      contractorId: ctx.contractorId,
      ...(sp.get('status') ? { status: sp.get('status')! } : {}),
      ...(sp.get('sessionId') ? { sessionId: sp.get('sessionId')! } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: sp.get('limit') ? Math.min(Number(sp.get('limit')) || 250, 500) : 250,
  })
  return NextResponse.json({ leads })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = LeadSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const lead = await createCanvassingLead(ctx, parsed.data)
  return NextResponse.json({ lead }, { status: 201 })
}
