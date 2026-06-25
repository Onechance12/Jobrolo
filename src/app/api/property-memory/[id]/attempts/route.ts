import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { recordDoorAttempt } from '@/lib/property-memory'

const Schema = z.object({
  canvassingLeadId: z.string().optional().nullable(), sessionId: z.string().optional().nullable(), outcome: z.string().min(1), contactName: z.string().optional().nullable(), contactRole: z.string().optional().nullable(), summary: z.string().optional().nullable(), scriptUsed: z.string().optional().nullable(), objection: z.string().optional().nullable(), nextStep: z.string().optional().nullable(), followUpAt: z.string().optional().nullable(),
  location: z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const attempt = await recordDoorAttempt(ctx, { ...parsed.data, propertyMemoryId: id })
  return NextResponse.json({ attempt }, { status: 201 })
}
