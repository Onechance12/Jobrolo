import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { getStreetResearchRuns, researchPropertyNow } from '@/lib/property-research'

const Schema = z.object({
  streets: z.array(z.string()).min(1),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
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
  const result = await getStreetResearchRuns(ctx, { status: sp.get('status'), limit: sp.get('limit') ? Number(sp.get('limit')) : undefined })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const result = await researchPropertyNow(ctx, { ...parsed.data, mode: 'street_game_plan' })
  return NextResponse.json(result, { status: 201 })
}
