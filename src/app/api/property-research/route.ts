import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { db } from '@/lib/db'
import { researchPropertyNow } from '@/lib/property-research'

const LocationSchema = z.object({ lat: z.number().optional().nullable(), lng: z.number().optional().nullable(), latitude: z.number().optional().nullable(), longitude: z.number().optional().nullable(), accuracyMeters: z.number().optional().nullable(), source: z.string().optional().nullable() }).optional().nullable()
const ResearchSchema = z.object({
  mode: z.string().optional().nullable(),
  query: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  streets: z.array(z.string()).optional().nullable(),
  location: LocationSchema,
  focusMode: z.string().optional().nullable(),
  energyLevel: z.string().optional().nullable(),
  mindset: z.string().optional().nullable(),
  timeBudgetMinutes: z.number().optional().nullable(),
  goalDoors: z.number().optional().nullable(),
  goalConversations: z.number().optional().nullable(),
  goalInspections: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  allowProviderLookup: z.boolean().optional().nullable(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const runs = await db.propertyResearchRun.findMany({
    where: { contractorId: ctx.contractorId, ...(sp.get('status') ? { status: sp.get('status')! } : {}), ...(sp.get('mode') ? { mode: sp.get('mode')! } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: sp.get('limit') ? Math.min(Number(sp.get('limit')) || 50, 100) : 50,
  })
  return NextResponse.json({ runs })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = ResearchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const result = await researchPropertyNow(ctx, parsed.data)
  return NextResponse.json(result, { status: 201 })
}
