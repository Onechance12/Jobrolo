import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { db } from '@/lib/db'
import { getPropertyMemoryContext, upsertPropertyMemory } from '@/lib/property-memory'

const PatchSchema = z.object({
  address: z.string().optional().nullable(), city: z.string().optional().nullable(), state: z.string().optional().nullable(), postalCode: z.string().optional().nullable(),
  propertyType: z.string().optional().nullable(), occupancyStatus: z.string().optional().nullable(), solicitationStatus: z.string().optional().nullable(),
  roofCondition: z.string().optional().nullable(), roofAgeSignal: z.string().optional().nullable(), damageSignal: z.string().optional().nullable(),
  opportunityScore: z.number().optional().nullable(), priority: z.string().optional().nullable(), status: z.string().optional().nullable(), summary: z.string().optional().nullable(), notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(), location: z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const result = await getPropertyMemoryContext(ctx, { propertyMemoryId: id, limit: 1 })
  if (!result.properties.length) return NextResponse.json({ error: 'Property memory not found' }, { status: 404 })
  return NextResponse.json({ property: result.properties[0], observations: result.observations, attempts: result.attempts })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const existing = await db.propertyMemory.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!existing) return NextResponse.json({ error: 'Property memory not found' }, { status: 404 })
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const property = await upsertPropertyMemory(ctx, { ...parsed.data, address: parsed.data.address ?? existing.address, dataSource: { source: 'property_memory_patch', propertyMemoryId: id } })
  return NextResponse.json({ property })
}
