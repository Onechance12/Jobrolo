import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { toFileUrl } from '@/lib/file-url'
import { linkDocumentToJobPacket } from '@/lib/project-context'
import { generatePhotoCaption, updateRoofReportChecklist } from '@/lib/roof-reports'

const PhotoSchema = z.object({
  documentId: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z.string().default('other'),
  area: z.string().optional(),
  condition: z.string().optional(),
  severity: z.string().default('informational'),
  caption: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tagsJson: z.string().optional(),
  aiCaptionStatus: z.string().optional(),
  isIncluded: z.boolean().optional(),
  isCoverPhoto: z.boolean().optional(),
  takenAt: z.string().optional(),
  sortOrder: z.number().int().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const report = await db.roofReport.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  const parsed = PhotoSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data

  let imageUrl = input.imageUrl
  if (input.documentId) {
    const doc = await db.document.findFirst({ where: { id: input.documentId, contractorId: ctx.contractorId } })
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    imageUrl = toFileUrl(doc.filePath)
    await linkDocumentToJobPacket({
      contractorId: ctx.contractorId,
      documentId: doc.id,
      projectId: report.projectId,
      customerId: report.customerId,
      entityType: 'roof_report',
      entityId: report.id,
      role: 'report_photo',
      label: input.caption || doc.originalName,
      source: 'system',
      metadata: { reportId: report.id, category: input.category },
    })
  }

  const caption = input.caption || generatePhotoCaption(input)
  const photo = await db.roofReportPhoto.create({
    data: {
      contractorId: ctx.contractorId,
      reportId: report.id,
      documentId: input.documentId,
      imageUrl,
      category: input.category,
      area: input.area,
      condition: input.condition,
      severity: input.severity,
      caption,
      notes: input.notes,
      tagsJson: input.tags ? JSON.stringify(input.tags) : input.tagsJson,
      aiCaptionStatus: input.aiCaptionStatus ?? (input.caption ? 'reviewed' : 'ai_suggested'),
      isIncluded: input.isIncluded ?? true,
      isCoverPhoto: input.isCoverPhoto ?? false,
      takenAt: input.takenAt ? new Date(input.takenAt) : undefined,
      sortOrder: input.sortOrder ?? 0,
    },
  })
  await updateRoofReportChecklist(ctx.contractorId, report.id)
  return NextResponse.json({ photo }, { status: 201 })
}
