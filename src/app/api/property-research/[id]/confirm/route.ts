import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { confirmPropertyResearchCandidate } from '@/lib/property-research'

const Schema = z.object({
  candidateId: z.string().optional().nullable(),
  createMemory: z.boolean().optional().nullable(),
  status: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  confirmedOwnerName: z.string().optional().nullable(),
  confirmedAddress: z.string().optional().nullable(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const result = await confirmPropertyResearchCandidate(ctx, id, parsed.data)
  return NextResponse.json(result)
}
