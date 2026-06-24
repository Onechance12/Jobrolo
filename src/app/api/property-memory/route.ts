import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { getPropertyMemoryContext, upsertPropertyMemory } from '@/lib/property-memory'

const LocationSchema = z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable()
const PropertySchema = z.object({
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  homeownerName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  primaryLeadId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable(),
  propertyType: z.string().optional().nullable(),
  occupancyStatus: z.string().optional().nullable(),
  solicitationStatus: z.string().optional().nullable(),
  roofCondition: z.string().optional().nullable(),
  roofAgeSignal: z.string().optional().nullable(),
  damageSignal: z.string().optional().nullable(),
  opportunityScore: z.number().optional().nullable(),
  priority: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  location: LocationSchema,
  dataSource: z.record(z.string(), z.any()).optional().nullable(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const result = await getPropertyMemoryContext(ctx, {
    propertyMemoryId: sp.get('id'),
    canvassingLeadId: sp.get('leadId'),
    address: sp.get('address'),
    status: sp.get('status'),
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
  })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = PropertySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const property = await upsertPropertyMemory(ctx, parsed.data)
  return NextResponse.json({ property }, { status: 201 })
}
