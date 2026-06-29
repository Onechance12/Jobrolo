import { db } from '@/lib/db'
import { safeJson, storageDescriptor } from '@/lib/dev-bridge'

export type DevCleanupAction =
  | 'move_price_sheet_to_company_pricing'
  | 'move_company_asset_to_profile_scope'
  | 'mark_stale_processing_document_needs_review'

export type DevCleanupCandidate = {
  id: string
  action: DevCleanupAction
  title: string
  severity: 'low' | 'normal' | 'high'
  contractorId: string
  documentId: string
  reason: string
  currentState: Record<string, unknown>
  proposedState: Record<string, unknown>
  safety: string[]
}

const COMPANY_ASSET_TYPES = ['company_logo', 'user_avatar']
const STALE_STATUSES = ['pending', 'processing', 'analyzing', 'needs_ocr']

export async function buildDevCleanupCandidates(input: { limit: number; staleSince: Date }) {
  const [priceSheets, companyAssets, staleDocs] = await Promise.all([
    db.document.findMany({
      where: {
        fileType: 'price_sheet',
        OR: [{ customerId: { not: null } }, { projectId: { not: null } }, { workspaceId: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true,
        contractorId: true,
        originalName: true,
        fileType: true,
        status: true,
        customerId: true,
        projectId: true,
        workspaceId: true,
        aiSummary: true,
        extractedData: true,
        createdAt: true,
      },
    }),
    db.document.findMany({
      where: {
        fileType: { in: COMPANY_ASSET_TYPES },
        OR: [{ customerId: { not: null } }, { projectId: { not: null } }, { workspaceId: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true,
        contractorId: true,
        originalName: true,
        fileType: true,
        status: true,
        customerId: true,
        projectId: true,
        workspaceId: true,
        filePath: true,
        thumbnailPath: true,
        aiSummary: true,
        createdAt: true,
      },
    }),
    db.document.findMany({
      where: { status: { in: STALE_STATUSES }, createdAt: { lte: input.staleSince } },
      orderBy: { createdAt: 'asc' },
      take: input.limit,
      select: {
        id: true,
        contractorId: true,
        originalName: true,
        fileType: true,
        status: true,
        customerId: true,
        projectId: true,
        workspaceId: true,
        aiSummary: true,
        extractionConfidence: true,
        missingDataFlags: true,
        conflictFlags: true,
        createdAt: true,
      },
    }),
  ])

  const candidates: DevCleanupCandidate[] = []

  for (const doc of priceSheets) {
    candidates.push({
      id: `price_sheet_scope:${doc.id}`,
      action: 'move_price_sheet_to_company_pricing',
      title: `Move price sheet out of customer/project scope: ${doc.originalName}`,
      severity: 'high',
      contractorId: doc.contractorId,
      documentId: doc.id,
      reason: 'Price sheets are company pricing by default and should not be buried inside a customer/project unless explicitly job-specific.',
      currentState: {
        fileType: doc.fileType,
        status: doc.status,
        customerId: doc.customerId,
        projectId: doc.projectId,
        workspaceId: doc.workspaceId,
        aiSummary: doc.aiSummary,
        extractedDataKeys: Object.keys(safeJson<Record<string, unknown> | null>(doc.extractedData, null) ?? {}),
      },
      proposedState: {
        customerId: null,
        projectId: null,
        workspaceId: null,
        fileType: 'price_sheet',
        status: doc.status,
        note: 'Keep the document as a company-level price sheet candidate/review item.',
      },
      safety: [
        'Does not delete the file.',
        'Does not import material rows.',
        'Does not alter extracted text.',
        'Should be skipped if the user explicitly said this was a job-specific supplier quote/invoice.',
      ],
    })
  }

  for (const doc of companyAssets) {
    candidates.push({
      id: `company_asset_scope:${doc.id}`,
      action: 'move_company_asset_to_profile_scope',
      title: `Move company/user asset out of job scope: ${doc.originalName}`,
      severity: 'normal',
      contractorId: doc.contractorId,
      documentId: doc.id,
      reason: 'Company logos and user avatars should live in company/user profile context, not inside customer/project files.',
      currentState: {
        fileType: doc.fileType,
        status: doc.status,
        customerId: doc.customerId,
        projectId: doc.projectId,
        workspaceId: doc.workspaceId,
        storage: storageDescriptor(doc.filePath),
        thumbnail: storageDescriptor(doc.thumbnailPath),
        aiSummary: doc.aiSummary,
      },
      proposedState: {
        customerId: null,
        projectId: null,
        workspaceId: null,
        fileType: doc.fileType,
        status: doc.status,
        note: 'Keep as profile/brand asset candidate.',
      },
      safety: [
        'Does not delete the file.',
        'Does not automatically overwrite the active logo/avatar.',
        'Only removes accidental operational linkage.',
      ],
    })
  }

  for (const doc of staleDocs) {
    candidates.push({
      id: `stale_processing_doc:${doc.id}`,
      action: 'mark_stale_processing_document_needs_review',
      title: `Review stale processing document: ${doc.originalName}`,
      severity: doc.status === 'needs_ocr' ? 'normal' : 'high',
      contractorId: doc.contractorId,
      documentId: doc.id,
      reason: 'This document has been stuck in a processing/OCR state past the configured stale threshold.',
      currentState: {
        fileType: doc.fileType,
        status: doc.status,
        customerId: doc.customerId,
        projectId: doc.projectId,
        workspaceId: doc.workspaceId,
        aiSummary: doc.aiSummary,
        extractionConfidence: doc.extractionConfidence,
        missingDataFlags: safeJson(doc.missingDataFlags, null),
        conflictFlags: safeJson(doc.conflictFlags, null),
        createdAt: doc.createdAt,
      },
      proposedState: {
        status: 'needs_review',
        note: 'Mark for human/Cody review instead of leaving it in a loading state.',
      },
      safety: [
        'Does not delete the file.',
        'Does not fabricate extracted content.',
        'Should not run if a worker is actively processing the document now.',
      ],
    })
  }

  return candidates
}

export async function buildDevCleanupDryRun(input: { action: DevCleanupAction; documentId: string; staleSince?: Date }) {
  const staleSince = input.staleSince ?? new Date(Date.now() - 30 * 60 * 1000)
  const candidates = await buildDevCleanupCandidates({ limit: 200, staleSince })
  const candidate = candidates.find(item => item.action === input.action && item.documentId === input.documentId)
  if (!candidate) return null
  return {
    ...candidate,
    dryRun: true,
    mutation: {
      wouldUpdateDocument: true,
      wouldCreateAuditLog: true,
      wouldCreateInboxItem: false,
      wouldDeleteFile: false,
    },
  }
}
