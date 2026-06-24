import { toFileUrl, toThumbnailUrl } from '@/lib/file-url'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { requireDocument } from '@/lib/security/ownership'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params

  // SECURITY: Use centralized ownership helper — returns 404 for cross-tenant
  const doc = await requireDocument(ctx, id)
  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Fetch with relations for the response
  const docWithRelations = await db.document.findUnique({
    where: { id },
    include: { project: { select: { id: true, title: true } }, customer: { select: { id: true, name: true } } },
  })
  if (!docWithRelations) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Don't return the full ocrText by default (can be 100k+ chars) — return length + a preview.
  // The chat-status hook polls this endpoint, so we want it lean.
  const fullOcr = docWithRelations.ocrText ?? ''
  const ocrPreview = fullOcr.length > 800 ? fullOcr.slice(0, 400) + '\n\n[...]\n\n' + fullOcr.slice(-400) : fullOcr

  // Determine a human-readable status detail
  let statusDetail = ''
  switch (docWithRelations.status) {
    case 'queued': statusDetail = 'Document queued for analysis.'; break
    case 'processing': statusDetail = 'Document is being analyzed.'; break
    case 'reviewed': statusDetail = 'Analysis complete.'; break
    case 'failed': statusDetail = 'Analysis failed. See aiSummary for details.'; break
    case 'needs_ocr': statusDetail = 'Scanned PDF — text extraction failed. OCR is required.'; break
    case 'pending_review': statusDetail = 'Awaiting review.'; break
    default: statusDetail = docWithRelations.status
  }

  return NextResponse.json({
    document: {
      id: docWithRelations.id,
      filename: docWithRelations.filename,
      originalName: docWithRelations.originalName,
      mimeType: docWithRelations.mimeType,
      size: docWithRelations.size,
      fileType: docWithRelations.fileType,
      url: toFileUrl(docWithRelations.filePath),
      thumbnailUrl: toThumbnailUrl(docWithRelations.thumbnailPath),
      aiSummary: docWithRelations.aiSummary,
      aiCategory: docWithRelations.aiCategory,
      extractedData: docWithRelations.extractedData ? JSON.parse(docWithRelations.extractedData) : null,
      status: docWithRelations.status,
      statusDetail,
      extractionMethod: docWithRelations.extractionMethod,
      // Collaborative extraction fields (v3)
      extractionConfidence: docWithRelations.extractionConfidence,
      conflicts: docWithRelations.conflictFlags ? JSON.parse(docWithRelations.conflictFlags) : null,
      missingData: docWithRelations.missingDataFlags ? JSON.parse(docWithRelations.missingDataFlags) : null,
      extractionComparison: docWithRelations.extractionComparison ? JSON.parse(docWithRelations.extractionComparison) : null,
      // Text length info (don't return full text — can be 100k+ chars)
      embeddedTextLength: docWithRelations.embeddedText?.length ?? 0,
      visionTextLength: docWithRelations.visionText?.length ?? 0,
      ocrTextLength: fullOcr.length,
      ocrTextPreview: ocrPreview || null,
      hasOcrText: fullOcr.length > 0,
      // Review notes are inside extractedData, but also expose directly for UI
      reviewNotes: docWithRelations.extractedData ? (JSON.parse(docWithRelations.extractedData).reviewNotes ?? []) : [],
      warnings: docWithRelations.extractedData ? (JSON.parse(docWithRelations.extractedData).warnings ?? []) : [],
      project: docWithRelations.project,
      customer: docWithRelations.customer,
      createdAt: docWithRelations.createdAt,
    },
  })
}
