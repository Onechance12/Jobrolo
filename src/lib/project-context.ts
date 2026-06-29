import { db } from '@/lib/db'
import { toFileUrl, toThumbnailUrl } from '@/lib/file-url'
import type { TenantContext } from '@/lib/security/context'
import { requireProject } from '@/lib/security/ownership'
import { getOrCreateContractorProfile, publicContractorProfile } from '@/lib/contractor-profile'

export type JobPacketEntityType =
  | 'project'
  | 'appointment'
  | 'roof_report'
  | 'generated_document'
  | 'signature_request'
  | 'scope_analysis'
  | 'task'
  | 'estimate'
  | 'template'
  | 'field_visit'
  | 'canvassing_lead'
  | 'action_request'
  | 'location_resolution'
  | 'other'

export type JobPacketRole =
  | 'source'
  | 'attachment'
  | 'signed_copy'
  | 'inspection_photo'
  | 'carrier_estimate'
  | 'supplement'
  | 'contract'
  | 'authorization'
  | 'report_photo'
  | 'evidence'
  | 'other'

function safeJson<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function shortRecordNumber(prefix: string, id?: string | null) {
  const clean = (id ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  return `${prefix}-${clean.slice(-6) || 'PENDING'}`
}

function customerNumber(id?: string | null) {
  return shortRecordNumber('C', id)
}

function projectNumber(project: { id?: string | null; title?: string | null } | string | null | undefined) {
  if (project && typeof project === 'object') {
    const match = (project.title ?? '').match(/\bJob\s*#?\s*(\d{4,})\b/i)
    if (match?.[1]) return `J-${match[1]}`
    return shortRecordNumber('P', project.id)
  }
  return shortRecordNumber('P', project)
}

function isProfileOrBrandAsset(doc: { fileType: string | null; aiCategory: string | null }) {
  const type = `${doc.fileType ?? ''} ${doc.aiCategory ?? ''}`.toLowerCase()
  return /\b(user[_ -]?avatar|profile[_ -]?photo|company[_ -]?logo|logo|brand[_ -]?asset)\b/.test(type)
}

function isPhotoDocument(doc: { fileType: string | null; mimeType: string | null }) {
  return doc.fileType === 'photo' || doc.mimeType?.startsWith('image/')
}

function isPriceSheetDocument(doc: { fileType: string | null; aiCategory: string | null; originalName: string; aiSummary?: string | null }) {
  const trustedTypeText = `${doc.fileType ?? ''} ${doc.aiCategory ?? ''}`.toLowerCase()
  if (/\b(price[_ -]?sheet|price[_ -]?list|company[_ -]?pricing|material[_ -]?pricing|supplier[_ -]?pricing)\b/.test(trustedTypeText)) return true

  const summaryText = (doc.aiSummary ?? '').toLowerCase()
  if (/\b(price\s*(?:sheet|list)|company pricing|material pricing|supplier pricing)\b/.test(summaryText)) return true

  // Filename is intentionally only a last-resort hint. Contractor PDFs are often renamed incorrectly.
  if (trustedTypeText.trim() || summaryText.trim()) return false
  return /\b(price[_ -]?sheet|price[_ -]?list)\b/i.test(doc.originalName)
}

function ocrReviewStatus(doc: {
  extractionConfidence: number | null
  conflictFlags: string | null
  missingDataFlags: string | null
  status: string
  extractionMethod: string | null
}) {
  const conflicts = safeJson<Record<string, unknown>>(doc.conflictFlags, {})
  const missingData = safeJson<Record<string, unknown>>(doc.missingDataFlags, {})
  const conflictCount = Object.values(conflicts).filter(Boolean).length
  const missingCount = Object.values(missingData).filter(Boolean).length
  const confidence = doc.extractionConfidence ?? null

  let reviewStatus: 'not_processed' | 'ok' | 'review_recommended' | 'review_required' = 'ok'
  if (doc.status === 'queued' || doc.status === 'processing') reviewStatus = 'not_processed'
  else if (doc.status === 'needs_ocr' || doc.status === 'failed') reviewStatus = 'review_required'
  else if ((confidence !== null && confidence < 70) || conflictCount > 0) reviewStatus = 'review_required'
  else if ((confidence !== null && confidence < 85) || missingCount > 0) reviewStatus = 'review_recommended'

  return {
    reviewStatus,
    confidence,
    extractionMethod: doc.extractionMethod,
    conflictCount,
    missingCount,
    conflicts,
    missingData,
  }
}

export async function createProjectTimelineEvent(input: {
  contractorId: string
  projectId?: string | null
  customerId?: string | null
  eventType: string
  title: string
  body?: string | null
  relatedType?: string | null
  relatedId?: string | null
  source?: string
  actorUserId?: string | null
  metadata?: unknown
  occurredAt?: Date
}) {
  if (!input.projectId) return null
  const project = await db.project.findFirst({
    where: { id: input.projectId, contractorId: input.contractorId },
    select: { id: true, customerId: true },
  })
  if (!project) return null

  return db.projectTimelineEvent.create({
    data: {
      contractorId: input.contractorId,
      projectId: project.id,
      customerId: input.customerId ?? project.customerId ?? undefined,
      eventType: input.eventType,
      title: input.title,
      body: input.body ?? undefined,
      relatedType: input.relatedType ?? undefined,
      relatedId: input.relatedId ?? undefined,
      source: input.source ?? 'system',
      actorUserId: input.actorUserId ?? undefined,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
      occurredAt: input.occurredAt ?? new Date(),
    },
  }).catch(() => null)
}

export async function linkDocumentToJobPacket(input: {
  contractorId: string
  documentId: string
  projectId?: string | null
  customerId?: string | null
  entityType?: JobPacketEntityType | string
  entityId?: string | null
  role?: JobPacketRole | string
  label?: string | null
  notes?: string | null
  source?: string
  confidence?: number
  metadata?: unknown
}) {
  const doc = await db.document.findFirst({
    where: { id: input.documentId, contractorId: input.contractorId },
    select: { id: true, projectId: true, customerId: true, originalName: true },
  })
  if (!doc) return null

  const projectId = input.projectId ?? doc.projectId ?? null
  const customerId = input.customerId ?? doc.customerId ?? null

  if (projectId) {
    const project = await db.project.findFirst({ where: { id: projectId, contractorId: input.contractorId }, select: { id: true } })
    if (!project) return null
  }
  if (customerId) {
    const customer = await db.customer.findFirst({ where: { id: customerId, contractorId: input.contractorId }, select: { id: true } })
    if (!customer) return null
  }

  const link = await db.documentLink.create({
    data: {
      contractorId: input.contractorId,
      documentId: doc.id,
      projectId: projectId ?? undefined,
      customerId: customerId ?? undefined,
      entityType: input.entityType ?? 'project',
      entityId: input.entityId ?? projectId ?? undefined,
      role: input.role ?? 'attachment',
      label: input.label ?? doc.originalName,
      notes: input.notes ?? undefined,
      source: input.source ?? 'user',
      confidence: input.confidence ?? 1,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  })

  if (projectId) {
    await createProjectTimelineEvent({
      contractorId: input.contractorId,
      projectId,
      customerId,
      eventType: 'document_linked',
      title: `Document linked: ${doc.originalName}`,
      relatedType: 'document',
      relatedId: doc.id,
      source: input.source ?? 'system',
      metadata: { role: input.role ?? 'attachment', entityType: input.entityType ?? 'project', entityId: input.entityId ?? projectId },
    })
  }

  return link
}

export async function getProjectDocumentPacket(projectId: string, contractorId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, contractorId },
    include: { customer: { select: { id: true, name: true, email: true, phone: true, address: true } } },
  })
  if (!project) return null

  const [contractorProfile, documents, documentLinks, roofReports, generatedDocuments, signatureRequests, scopeAnalyses, customerProjects] = await Promise.all([
    getOrCreateContractorProfile(contractorId),
    db.document.findMany({
      where: { contractorId, projectId },
      include: { scopeAnalysis: true },
      orderBy: { createdAt: 'desc' },
      take: 250,
    }),
    db.documentLink.findMany({
      where: { contractorId, projectId },
      orderBy: { createdAt: 'desc' },
      take: 250,
    }),
    db.roofReport.findMany({
      where: { contractorId, projectId },
      include: { photos: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
    db.generatedDocument.findMany({
      where: { contractorId, projectId },
      include: { signatureRequests: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    db.signatureRequest.findMany({
      where: { contractorId, projectId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    db.scopeAnalysis.findMany({
      where: { contractorId, document: { projectId } },
      include: { document: { select: { id: true, originalName: true, fileType: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    project.customerId
      ? db.project.findMany({
          where: { contractorId, customerId: project.customerId },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
          take: 250,
        })
      : Promise.resolve([]),
  ])

  const normalizedDocuments = documents.map(doc => {
    const extracted = safeJson<Record<string, unknown>>(doc.extractedData, {})
    return {
      id: doc.id,
      originalName: doc.originalName,
      filename: doc.filename,
      fileType: doc.fileType,
      mimeType: doc.mimeType,
      size: doc.size,
      url: toFileUrl(doc.filePath),
      thumbnailUrl: toThumbnailUrl(doc.thumbnailPath),
      aiCategory: doc.aiCategory,
      aiSummary: doc.aiSummary,
      status: doc.status,
      createdAt: doc.createdAt,
      ocr: {
        ...ocrReviewStatus(doc),
        embeddedTextLength: doc.embeddedText?.length ?? 0,
        visionTextLength: doc.visionText?.length ?? 0,
        finalTextLength: doc.ocrText?.length ?? 0,
        provider: extracted.ocrProvider ?? null,
        reviewNotes: Array.isArray(extracted.reviewNotes) ? extracted.reviewNotes : [],
        warnings: Array.isArray(extracted.warnings) ? extracted.warnings : [],
      },
      scopeAnalysisCount: doc.scopeAnalysis.length,
    }
  })

  const projectOrdinal = Math.max(customerProjects.findIndex(p => p.id === project.id) + 1, 1)
  const savedCustomerNumber = project.customer ? customerNumber(project.customer.id) : null
  const savedProjectNumber = projectNumber(project)
  const customerProjectNumber = savedCustomerNumber ? `${savedCustomerNumber}-${projectOrdinal}` : savedProjectNumber
  const photoDocuments = normalizedDocuments.filter(doc => isPhotoDocument(doc) && !isProfileOrBrandAsset(doc))
  const priceSheetDocuments = normalizedDocuments.filter(isPriceSheetDocument)
  const jobDocuments = normalizedDocuments.filter(doc => !isPhotoDocument(doc) && !isPriceSheetDocument(doc) && !isProfileOrBrandAsset(doc))
  const needsReviewDocuments = normalizedDocuments.filter(doc => doc.ocr.reviewStatus === 'review_required' || doc.ocr.reviewStatus === 'review_recommended')
  const pendingSignatures = signatureRequests.filter(request => !['signed', 'voided', 'expired', 'declined'].includes(request.status))

  const groupedLinks = documentLinks.reduce<Record<string, typeof documentLinks>>((acc, link) => {
    const key = `${link.entityType}:${link.entityId ?? 'project'}`
    acc[key] ??= []
    acc[key].push(link)
    return acc
  }, {})

  return {
    contractorProfile: publicContractorProfile(contractorProfile),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      priority: project.priority,
      address: project.address,
      value: project.value,
      projectNumber: savedProjectNumber,
      customerProjectNumber,
      customerProjectOrdinal: projectOrdinal,
      customer: project.customer ? {
        ...project.customer,
        customerNumber: savedCustomerNumber,
        clientNumber: savedCustomerNumber,
      } : null,
    },
    documents: normalizedDocuments,
    documentGroups: {
      photos: photoDocuments,
      jobDocuments,
      priceSheets: priceSheetDocuments,
      needsReview: needsReviewDocuments,
    },
    documentLinks,
    linksByEntity: groupedLinks,
    roofReports,
    generatedDocuments,
    signatureRequests,
    scopeAnalyses,
    counts: {
      documents: documents.length,
      linkedDocuments: documentLinks.length,
      roofReports: roofReports.length,
      generatedDocuments: generatedDocuments.length,
      signatureRequests: signatureRequests.length,
      pendingSignatures: pendingSignatures.length,
      scopeAnalyses: scopeAnalyses.length,
      ocrReviewRequired: normalizedDocuments.filter(d => d.ocr.reviewStatus === 'review_required').length,
      ocrReviewRecommended: normalizedDocuments.filter(d => d.ocr.reviewStatus === 'review_recommended').length,
      photos: photoDocuments.length,
      jobDocuments: jobDocuments.length,
      priceSheets: priceSheetDocuments.length,
      needsReview: needsReviewDocuments.length,
      customerProjects: customerProjects.length,
    },
  }
}

export async function getProjectContextByContractor(projectId: string, contractorId: string) {
  const project = await db.project.findFirst({ where: { id: projectId, contractorId } })
  if (!project) return null

  const [contractorProfile, customer, schedule, appointments, tasks, notes, followUps, estimates, packet, timelineEvents, activities, memories] = await Promise.all([
    getOrCreateContractorProfile(contractorId),
    project.customerId ? db.customer.findFirst({ where: { id: project.customerId, contractorId } }) : Promise.resolve(null),
    db.projectSchedule.findUnique({ where: { contractorId_projectId: { contractorId, projectId } } }).catch(() => null),
    db.appointment.findMany({ where: { contractorId, projectId }, orderBy: { startTime: 'asc' }, take: 50 }),
    db.task.findMany({ where: { projectId }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], take: 50 }),
    db.note.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 25 }),
    db.followUp.findMany({ where: { projectId, customer: { contractorId } }, orderBy: { dueDate: 'asc' }, take: 25 }),
    db.estimate.findMany({ where: { contractorId, projectId }, orderBy: { updatedAt: 'desc' }, take: 25 }),
    getProjectDocumentPacket(projectId, contractorId),
    db.projectTimelineEvent.findMany({ where: { contractorId, projectId }, orderBy: { occurredAt: 'desc' }, take: 100 }),
    db.projectActivity.findMany({ where: { contractorId, projectId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.projectMemory.findMany({ where: { contractorId, projectId }, orderBy: { updatedAt: 'desc' }, take: 25 }),
  ])

  const openTasks = tasks.filter(t => t.status !== 'completed')
  const upcomingAppointments = appointments.filter(a => a.status === 'scheduled' && a.startTime >= new Date())
  const signatureRequests = packet?.signatureRequests ?? []
  const pendingSignatures = signatureRequests.filter(s => !['signed', 'voided', 'expired', 'declined'].includes(s.status))

  return {
    contractorProfile: publicContractorProfile(contractorProfile),
    project: { ...project, customer },
    schedule,
    upcomingAppointments,
    appointments,
    openTasks,
    tasks,
    notes,
    followUps,
    estimates,
    packet,
    timelineEvents,
    activities,
    memories,
    ocrReview: packet ? {
      required: packet.counts.ocrReviewRequired,
      recommended: packet.counts.ocrReviewRecommended,
      documents: packet.documents.filter(d => d.ocr.reviewStatus !== 'ok'),
    } : { required: 0, recommended: 0, documents: [] },
    nextActionSignals: {
      hasUpcomingAppointment: upcomingAppointments.length > 0,
      hasOpenTasks: openTasks.length > 0,
      hasPendingSignatures: pendingSignatures.length > 0,
      hasDocumentsNeedingOcrReview: Boolean(packet && packet.counts.ocrReviewRequired > 0),
      hasRoofReport: Boolean(packet && packet.roofReports.length > 0),
      hasScopeAnalysis: Boolean(packet && packet.scopeAnalyses.length > 0),
    },
  }
}


export async function getProjectContext(ctx: TenantContext, projectId: string) {
  const project = await requireProject(ctx, projectId)
  if (!project) return null
  return getProjectContextByContractor(projectId, ctx.contractorId)
}


export async function getProjectTimeline(projectId: string, contractorId: string, limit = 100) {
  const project = await db.project.findFirst({ where: { id: projectId, contractorId }, select: { id: true } })
  if (!project) return null
  const events = await db.projectTimelineEvent.findMany({
    where: { contractorId, projectId },
    orderBy: { occurredAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 250),
  })
  return { projectId, count: events.length, events }
}

export async function getContractorOcrReviewQueue(contractorId: string, options: { projectId?: string | null; limit?: number } = {}) {
  const where = {
    contractorId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    OR: [
      { status: 'needs_ocr' },
      { status: 'failed' },
      { extractionConfidence: { lt: 85 } },
      { conflictFlags: { not: null } },
      { missingDataFlags: { not: null } },
    ],
  }
  const docs = await db.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(options.limit ?? 50, 1), 250),
    include: { project: { select: { id: true, title: true, address: true } }, customer: { select: { id: true, name: true } } },
  })
  const documents = docs.map(doc => {
    const extracted = safeJson<Record<string, unknown>>(doc.extractedData, {})
    return {
      id: doc.id,
      originalName: doc.originalName,
      fileType: doc.fileType,
      aiCategory: doc.aiCategory,
      status: doc.status,
      projectId: doc.projectId,
      customerId: doc.customerId,
      project: doc.project,
      customer: doc.customer,
      url: toFileUrl(doc.filePath),
      thumbnailUrl: toThumbnailUrl(doc.thumbnailPath),
      createdAt: doc.createdAt,
      ocr: {
        ...ocrReviewStatus(doc),
        embeddedTextLength: doc.embeddedText?.length ?? 0,
        visionTextLength: doc.visionText?.length ?? 0,
        finalTextLength: doc.ocrText?.length ?? 0,
        provider: extracted.ocrProvider ?? null,
        reviewNotes: Array.isArray(extracted.reviewNotes) ? extracted.reviewNotes : [],
        warnings: Array.isArray(extracted.warnings) ? extracted.warnings : [],
      },
    }
  }).filter(d => d.ocr.reviewStatus !== 'ok')
  return {
    count: documents.length,
    documents,
    required: documents.filter(d => d.ocr.reviewStatus === 'review_required').length,
    recommended: documents.filter(d => d.ocr.reviewStatus === 'review_recommended').length,
  }
}
