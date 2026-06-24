import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { db } from '@/lib/db'
import { createCanvassingGamePlan } from '@/lib/property-memory'

const Schema = z.object({
  sessionId: z.string().optional().nullable(), title: z.string().optional().nullable(), territoryName: z.string().optional().nullable(), focusMode: z.string().optional().nullable(), energyLevel: z.string().optional().nullable(), customerFocus: z.string().optional().nullable(), timeBudgetMinutes: z.number().optional().nullable(), goalDoors: z.number().optional().nullable(), goalConversations: z.number().optional().nullable(), goalInspections: z.number().optional().nullable(), notes: z.string().optional().nullable(),
  location: z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const plans = await db.canvassingGamePlan.findMany({ where: { contractorId: ctx.contractorId, ...(sp.get('status') ? { status: sp.get('status')! } : {}) }, orderBy: { updatedAt: 'desc' }, take: 50 })
  return NextResponse.json({ plans })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const result = await createCanvassingGamePlan(ctx, parsed.data)
  return NextResponse.json(result, { status: 201 })
}
