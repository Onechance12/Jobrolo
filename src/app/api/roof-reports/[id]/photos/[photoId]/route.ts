import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { updateRoofReportChecklist } from '@/lib/roof-reports'

const PatchSchema = z.object({
  category: z.string().optional(),
  area: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  severity: z.string().optional(),
  caption: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  tagsJson: z.string().nullable().optional(),
  aiCaptionStatus: z.string().optional(),
  isIncluded: z.boolean().optional(),
  isCoverPhoto: z.boolean().optional(),
  takenAt: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id, photoId } = await params
  const report = await db.roofReport.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  const parsed = PatchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  const existing = await db.roofReportPhoto.findFirst({ where: { id: photoId, reportId: id, contractorId: ctx.contractorId } })
  if (!existing) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  const photo = await db.roofReportPhoto.update({
    where: { id: photoId },
    data: {
      category: input.category,
      area: input.area,
      condition: input.condition,
      severity: input.severity,
      caption: input.caption,
      notes: input.notes,
      tagsJson: input.tags ? JSON.stringify(input.tags) : input.tagsJson,
      aiCaptionStatus: input.aiCaptionStatus,
      isIncluded: input.isIncluded,
      isCoverPhoto: input.isCoverPhoto,
      takenAt: input.takenAt ? new Date(input.takenAt) : input.takenAt === null ? null : undefined,
      sortOrder: input.sortOrder,
    },
  })
  await updateRoofReportChecklist(ctx.contractorId, id)
  return NextResponse.json({ photo })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id, photoId } = await params
  const report = await db.roofReport.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  const existing = await db.roofReportPhoto.findFirst({ where: { id: photoId, reportId: id, contractorId: ctx.contractorId } })
  if (!existing) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  await db.roofReportPhoto.delete({ where: { id: photoId } })
  await updateRoofReportChecklist(ctx.contractorId, id)
  return NextResponse.json({ ok: true })
}
