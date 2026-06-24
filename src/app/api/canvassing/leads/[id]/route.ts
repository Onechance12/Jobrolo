import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { updateCanvassingLead } from '@/lib/canvassing'

const LocationSchema = z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable()
const PatchSchema = z.object({ sessionId: z.string().optional().nullable(), address: z.string().optional().nullable(), homeownerName: z.string().optional().nullable(), phone: z.string().optional().nullable(), notes: z.string().optional().nullable(), status: z.string().optional().nullable(), location: LocationSchema, metadata: z.record(z.string(), z.any()).optional().nullable() })

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const lead = await db.canvassingLead.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const activities = await db.canvassingActivity.findMany({ where: { contractorId: ctx.contractorId, leadId: lead.id }, orderBy: { createdAt: 'desc' }, take: 100 })
  return NextResponse.json({ lead, activities })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const lead = await updateCanvassingLead(ctx, id, parsed.data)
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ lead })
}
