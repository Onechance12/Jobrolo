import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { logCanvassingActivity } from '@/lib/canvassing'

const LocationSchema = z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable()
const ActivitySchema = z.object({ sessionId: z.string().optional().nullable(), type: z.string().min(1), summary: z.string().optional().nullable(), status: z.string().optional().nullable(), notes: z.string().optional().nullable(), location: LocationSchema, metadata: z.record(z.string(), z.any()).optional().nullable() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const parsed = ActivitySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const result = await logCanvassingActivity(ctx, { ...parsed.data, leadId: id })
  return NextResponse.json(result, { status: 201 })
}
