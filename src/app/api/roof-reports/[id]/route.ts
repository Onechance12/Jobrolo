import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.string().optional(),
  mode: z.string().optional(),
  summaryTone: z.string().optional(),
  internalNotes: z.string().nullable().optional(),
  inspectionDate: z.string().datetime().nullable().optional(),
  inspectorName: z.string().nullable().optional(),
  propertyAddress: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  claimNumber: z.string().nullable().optional(),
  introduction: z.string().nullable().optional(),
  propertyReviewSummary: z.string().nullable().optional(),
  observedConditions: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
  conclusion: z.string().nullable().optional(),
  disclaimer: z.string().nullable().optional(),
  finalized: z.boolean().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const report = await db.roofReport.findFirst({ where: { id, contractorId: ctx.contractorId }, include: { photos: { orderBy: { sortOrder: 'asc' } } } })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ report })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const existing = await db.roofReport.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = PatchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  const report = await db.roofReport.update({
    where: { id },
    data: {
      title: input.title,
      status: input.status ?? (input.finalized ? 'finalized' : undefined),
      mode: input.mode,
      summaryTone: input.summaryTone,
      internalNotes: input.internalNotes,
      inspectionDate: input.inspectionDate ? new Date(input.inspectionDate) : input.inspectionDate === null ? null : undefined,
      inspectorName: input.inspectorName,
      propertyAddress: input.propertyAddress,
      clientName: input.clientName,
      claimNumber: input.claimNumber,
      introduction: input.introduction,
      propertyReviewSummary: input.propertyReviewSummary,
      observedConditionsJson: input.observedConditions ? JSON.stringify(input.observedConditions) : undefined,
      recommendationsJson: input.recommendations ? JSON.stringify(input.recommendations) : undefined,
      conclusion: input.conclusion,
      disclaimer: input.disclaimer,
      finalizedAt: input.finalized ? new Date() : undefined,
    },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
  return NextResponse.json({ report })
}
