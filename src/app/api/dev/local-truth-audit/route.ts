import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { boundedLimit, minutesAgo, requireDevBridge, safeJson, storageDescriptor } from '@/lib/dev-bridge'

export const runtime = 'nodejs'

const COMPANY_ASSET_TYPES = ['company_logo', 'user_avatar']
const PROCESSING_STATUSES = ['pending', 'processing', 'analyzing', 'needs_ocr']

function normalize(value: string | null | undefined) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function countMap(rows: Array<{ [key: string]: unknown; _count: { _all: number } }>, key: string) {
  return Object.fromEntries(rows.map(row => [String(row[key] ?? 'unknown'), row._count._all]))
}

export async function GET(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const limit = boundedLimit(url.searchParams.get('limit'), 25, 100)
  const staleSince = minutesAgo(url.searchParams.get('staleMinutes'), 30)

  const [
    documentStatusRows,
    documentTypeRows,
    documentLinkRoleRows,
    companyAssetsLinkedToJobs,
    priceSheetsLinkedToJobs,
    staleProcessingDocs,
    pendingReviews,
    pendingActions,
    codyNotes,
    contractors,
    customers,
    priceSheets,
    materialItemsCount,
    financialCandidateCount,
  ] = await Promise.all([
    db.document.groupBy({ by: ['status'], _count: { _all: true } }),
    db.document.groupBy({ by: ['fileType'], _count: { _all: true } }),
    db.documentLink.groupBy({ by: ['role'], _count: { _all: true } }),
    db.document.findMany({
      where: {
        fileType: { in: COMPANY_ASSET_TYPES },
        OR: [{ customerId: { not: null } }, { projectId: { not: null } }, { workspaceId: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, originalName: true, fileType: true, status: true, customerId: true, projectId: true, workspaceId: true, filePath: true, thumbnailPath: true, createdAt: true },
    }),
    db.document.findMany({
      where: {
        fileType: 'price_sheet',
        OR: [{ customerId: { not: null } }, { projectId: { not: null } }, { workspaceId: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, originalName: true, fileType: true, status: true, customerId: true, projectId: true, workspaceId: true, createdAt: true },
    }),
    db.document.findMany({
      where: { status: { in: PROCESSING_STATUSES }, createdAt: { lte: staleSince } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, contractorId: true, originalName: true, fileType: true, status: true, aiSummary: true, extractionConfidence: true, createdAt: true },
    }),
    db.document.findMany({
      where: { status: { in: ['pending_review', 'needs_review'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, originalName: true, fileType: true, status: true, customerId: true, projectId: true, aiSummary: true, createdAt: true },
    }),
    db.actionRequest.findMany({
      where: { status: { in: ['pending', 'needs_approval', 'routed'] } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { id: true, contractorId: true, type: true, title: true, status: true, priority: true, projectId: true, customerId: true, createdAt: true },
    }),
    db.inboxItem.findMany({
      where: { type: { in: ['tester_feedback', 'cody_observation'] }, status: { in: ['unread', 'read'] } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { id: true, contractorId: true, title: true, summary: true, status: true, priority: true, payloadJson: true, createdAt: true },
    }),
    db.contractor.findMany({ select: { id: true, company: true, name: true }, take: 500 }),
    db.customer.findMany({ select: { id: true, contractorId: true, name: true, email: true, phone: true, address: true, createdAt: true }, take: 1000 }),
    db.priceSheet.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, supplierName: true, originalName: true, status: true, createdAt: true },
    }),
    db.materialItem.count(),
    db.projectFinancialEntry.count({ where: { status: 'candidate' } }),
  ])

  const contractorNameById = new Map(contractors.map(contractor => [
    contractor.id,
    normalize(contractor.company || contractor.name),
  ]))
  const customersNamedLikeContractor = customers
    .filter(customer => {
      const contractorName = contractorNameById.get(customer.contractorId)
      return contractorName && normalize(customer.name) === contractorName
    })
    .slice(0, limit)

  const warnings: string[] = []
  if (companyAssetsLinkedToJobs.length) warnings.push(`${companyAssetsLinkedToJobs.length} company/user assets appear linked to customer/project/workspace records.`)
  if (priceSheetsLinkedToJobs.length) warnings.push(`${priceSheetsLinkedToJobs.length} price-sheet documents appear linked to customer/project/workspace records.`)
  if (staleProcessingDocs.length) warnings.push(`${staleProcessingDocs.length} documents have been processing longer than the stale threshold.`)
  if (customersNamedLikeContractor.length) warnings.push(`${customersNamedLikeContractor.length} customers appear to have the same name as their contractor company.`)
  if (financialCandidateCount) warnings.push(`${financialCandidateCount} candidate financial entries need review before becoming job-cost truth.`)

  return NextResponse.json({
    status: warnings.length ? 'needs_review' : 'ok',
    timestamp: new Date().toISOString(),
    dryRun: true,
    filters: { limit, staleSince },
    counts: {
      documentsByStatus: countMap(documentStatusRows, 'status'),
      documentsByFileType: countMap(documentTypeRows, 'fileType'),
      documentLinksByRole: countMap(documentLinkRoleRows, 'role'),
      materialItems: materialItemsCount,
      candidateFinancialEntries: financialCandidateCount,
    },
    suspicious: {
      companyAssetsLinkedToJobs: companyAssetsLinkedToJobs.map(doc => ({
        ...doc,
        storage: storageDescriptor(doc.filePath),
        thumbnail: storageDescriptor(doc.thumbnailPath),
        filePath: undefined,
        thumbnailPath: undefined,
      })),
      priceSheetsLinkedToJobs,
      staleProcessingDocuments: staleProcessingDocs,
      pendingReviewDocuments: pendingReviews,
      customersNamedLikeContractor,
    },
    queues: {
      pendingActions,
      openCodyNotes: codyNotes.map(item => ({
        ...item,
        payload: safeJson(item.payloadJson, null),
        payloadJson: undefined,
      })),
    },
    companyPricing: {
      priceSheets,
      materialItemsCount,
    },
    warnings,
  })
}
