import { toFileUrl, toThumbnailUrl } from '@/lib/file-url'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { requireDocument } from '@/lib/security/ownership'
import { enqueueAgentJob, kickAgentJob } from '@/lib/jobs/queue'
export const runtime = 'nodejs'

const STUCK_DOCUMENT_JOB_MS = 2 * 60 * 1000

function isAnalyzingStatus(status: string) {
  return status === 'queued' || status === 'processing'
}

async function nudgeDocumentAnalysis(input: {
  documentId: string
  contractorId: string
  userId?: string | null
  workspaceId?: string | null
  status: string
}) {
  if (!isAnalyzingStatus(input.status)) return null
  const latestJob = await db.agentJob.findFirst({
    where: { contractorId: input.contractorId, type: 'doc_analysis', inputJson: { contains: input.documentId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, updatedAt: true, error: true },
  })

  if (latestJob?.status === 'queued') {
    kickAgentJob(latestJob.id, `document-status:${input.documentId}`)
    return { action: 'kicked_queued_job', jobId: latestJob.id }
  }

  if (latestJob?.status === 'processing') {
    const stale = Date.now() - latestJob.updatedAt.getTime() > STUCK_DOCUMENT_JOB_MS
    if (!stale) return { action: 'already_processing', jobId: latestJob.id }
    await db.agentJob.updateMany({
      where: { id: latestJob.id, status: 'processing', contractorId: input.contractorId },
      data: { status: 'queued', heartbeat: 'Recovered stale document analysis job from status poll' },
    })
    kickAgentJob(latestJob.id, `document-status-stale:${input.documentId}`)
    return { action: 'requeued_stale_processing_job', jobId: latestJob.id }
  }

  if (!input.userId) return { action: 'cannot_enqueue_without_uploaded_by_user', jobId: latestJob?.id ?? null, previousStatus: latestJob?.status ?? 'missing' }

  const job = await enqueueAgentJob({
    contractorId: input.contractorId,
    userId: input.userId,
    type: 'doc_analysis',
    input: { documentId: input.documentId, heicConversionNeeded: false },
    workspaceId: input.workspaceId ?? undefined,
    priority: 4,
  })
  kickAgentJob(job.id, `document-status-new:${input.documentId}`)
  return { action: 'enqueued_replacement_job', jobId: job.id, previousStatus: latestJob?.status ?? 'missing' }
}

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
  const docWithRelations = await db.document.findFirst({
    where: { id, contractorId: ctx.contractorId },
    include: { project: { select: { id: true, title: true } }, customer: { select: { id: true, name: true } } },
  })
  if (!docWithRelations) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const analysisNudge = await nudgeDocumentAnalysis({
    documentId: docWithRelations.id,
    contractorId: ctx.contractorId,
    userId: docWithRelations.uploadedById,
    workspaceId: docWithRelations.workspaceId,
    status: docWithRelations.status,
  }).catch(err => {
    console.error(`[documents/${id}] analysis nudge failed:`, err)
    return { action: 'nudge_failed', error: err instanceof Error ? err.message : String(err) }
  })

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
      analysisNudge,
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
