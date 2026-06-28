import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireDevBridge, safeJson, storageDescriptor } from '@/lib/dev-bridge'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const { id } = await params
  const doc = await db.document.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, address: true } },
      project: { select: { id: true, title: true, status: true, address: true, customerId: true } },
      workspace: { select: { id: true, name: true, type: true, projectId: true, customerId: true } },
      uploadedBy: { select: { id: true, name: true, email: true, role: true } },
      scopeAnalysis: { select: { id: true, documentId: true, originalRcv: true, originalAcv: true, deductible: true, lineItemsJson: true, createdAt: true, updatedAt: true } },
    },
  })

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const [links, jobs, priceSheet] = await Promise.all([
    db.documentLink.findMany({
      where: { contractorId: doc.contractorId, documentId: doc.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db.agentJob.findMany({
      where: {
        contractorId: doc.contractorId,
        OR: [
          { inputJson: { contains: doc.id } },
          { outputJson: { contains: doc.id } },
          { error: { contains: doc.id } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, type: true, status: true, priority: true, heartbeat: true, error: true, inputJson: true, outputJson: true, thinkingJson: true, createdAt: true, startedAt: true, completedAt: true, updatedAt: true },
    }),
    db.priceSheet.findFirst({
      where: { contractorId: doc.contractorId, OR: [{ filePath: doc.filePath }, { originalName: doc.originalName }, { filename: doc.filename }] },
      select: { id: true, supplierId: true, supplierName: true, filename: true, originalName: true, status: true, validFrom: true, validUntil: true, notes: true, createdAt: true },
    }),
  ])

  const extracted = safeJson<Record<string, unknown> | null>(doc.extractedData, null)
  const uploadContext = extracted && typeof extracted.uploadContext === 'object' && !Array.isArray(extracted.uploadContext)
    ? extracted.uploadContext
    : null

  return NextResponse.json({
    status: 'ok',
    document: {
      id: doc.id,
      contractorId: doc.contractorId,
      originalName: doc.originalName,
      filename: doc.filename,
      mimeType: doc.mimeType,
      size: doc.size,
      fileType: doc.fileType,
      aiCategory: doc.aiCategory,
      aiSummary: doc.aiSummary,
      status: doc.status,
      storage: storageDescriptor(doc.filePath),
      thumbnail: storageDescriptor(doc.thumbnailPath),
      extractionMethod: doc.extractionMethod,
      extractionConfidence: doc.extractionConfidence,
      missingDataFlags: safeJson(doc.missingDataFlags, null),
      conflictFlags: safeJson(doc.conflictFlags, null),
      uploadContext,
      customerId: doc.customerId,
      projectId: doc.projectId,
      workspaceId: doc.workspaceId,
      uploadedById: doc.uploadedById,
      createdAt: doc.createdAt,
    },
    ownership: {
      customer: doc.customer,
      project: doc.project,
      workspace: doc.workspace,
      uploadedBy: doc.uploadedBy,
    },
    extractedPreview: {
      embeddedTextChars: doc.embeddedText?.length ?? 0,
      visionTextChars: doc.visionText?.length ?? 0,
      ocrTextChars: doc.ocrText?.length ?? 0,
      extractedDataKeys: extracted ? Object.keys(extracted).slice(0, 50) : [],
    },
    links: links.map(link => ({ ...link, metadata: safeJson(link.metadataJson, null), metadataJson: undefined })),
    scopeAnalyses: doc.scopeAnalysis.map(scope => ({
      id: scope.id,
      documentId: scope.documentId,
      originalRcv: scope.originalRcv,
      originalAcv: scope.originalAcv,
      deductible: scope.deductible,
      lineItemCount: safeJson<unknown[]>(scope.lineItemsJson, []).length,
      createdAt: scope.createdAt,
      updatedAt: scope.updatedAt,
    })),
    priceSheet,
    jobs: jobs.map(job => ({
      id: job.id,
      type: job.type,
      status: job.status,
      priority: job.priority,
      heartbeat: job.heartbeat,
      error: job.error,
      input: safeJson(job.inputJson, null),
      output: safeJson(job.outputJson, null),
      thinking: safeJson(job.thinkingJson, []),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      updatedAt: job.updatedAt,
    })),
  })
}
