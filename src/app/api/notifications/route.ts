import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { createRoleNotification, listNotifications } from '@/lib/notifications'
import { hasCompanyWideAccess } from '@/lib/security/ownership'
import { toFileUrl, toThumbnailUrl } from '@/lib/file-url'

const CreateNotificationSchema = z.object({
  role: z.string().min(1).max(80),
  userId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  type: z.string().min(1).max(80).default('manual'),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
  relatedType: z.string().max(80).optional().nullable(),
  relatedId: z.string().optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional().nullable(),
})

function safeJson(value: string | null | undefined) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const notifications = await listNotifications(ctx, {
    status: sp.get('status'),
    role: sp.get('role'),
    projectId: sp.get('projectId'),
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
  })
  const syntheticItems = hasCompanyWideAccess(ctx) ? await buildSyntheticActionItems(ctx.contractorId, ctx.user?.role ?? 'owner') : []
  return NextResponse.json({
    ...notifications,
    count: notifications.items.length + syntheticItems.length,
    items: [...syntheticItems, ...notifications.items],
  })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = CreateNotificationSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const item = await createRoleNotification({ contractorId: ctx.contractorId, ...parsed.data })
  return NextResponse.json({ notification: item }, { status: 201 })
}

async function buildSyntheticActionItems(contractorId: string, role: string) {
  const [actionRequests, reviewDocs] = await Promise.all([
    db.actionRequest.findMany({
      where: { contractorId, status: { in: ['pending', 'needs_approval', 'approved'] } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 15,
      select: { id: true, type: true, title: true, summary: true, priority: true, requestedRole: true, projectId: true, customerId: true, status: true, payloadJson: true, createdAt: true },
    }),
    db.document.findMany({
      where: {
        contractorId,
        OR: [
          { status: { in: ['pending_review', 'needs_review', 'needs_ocr', 'failed', 'processing'] } },
          { fileType: 'price_sheet', status: { not: 'reviewed' } },
          { conflictFlags: { not: null } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
      select: {
        id: true,
        originalName: true,
        fileType: true,
        status: true,
        aiSummary: true,
        extractionConfidence: true,
        conflictFlags: true,
        mimeType: true,
        size: true,
        filePath: true,
        thumbnailPath: true,
        projectId: true,
        customerId: true,
        createdAt: true,
      },
    }),
  ])

  const actionItems = actionRequests.map(item => {
    const payload = safeJson(item.payloadJson) as Record<string, any> | null
    return {
      id: `synthetic:action:${item.id}`,
      type: 'pending_action',
      title: item.title,
      summary: item.summary,
      priority: item.priority,
      status: item.status,
      role: item.requestedRole,
      projectId: item.projectId,
      customerId: item.customerId,
      actionRequestId: item.id,
      relatedType: 'action_request',
      relatedId: item.id,
      payloadJson: JSON.stringify({
        actionRequestId: item.id,
        cardType: 'action_request',
        toolName: payload?.toolName,
        approvalDetails: payload?.approvalDetails,
        synthetic: true,
      }),
      createdAt: item.createdAt,
      synthetic: true,
    }
  })

  const docItems = reviewDocs.map(doc => ({
    id: `synthetic:document:${doc.id}`,
    type: doc.fileType === 'price_sheet' ? 'price_sheet_review' : doc.conflictFlags ? 'document_conflict' : 'document_review',
    title: doc.fileType === 'price_sheet' ? `Review price sheet: ${doc.originalName}` : `Review document: ${doc.originalName}`,
    summary: doc.aiSummary || `Status: ${doc.status}${typeof doc.extractionConfidence === 'number' ? ` · confidence ${Math.round(doc.extractionConfidence)}%` : ''}`,
    priority: doc.status === 'failed' || doc.conflictFlags ? 'high' : 'normal',
    status: 'unread',
    role,
    projectId: doc.projectId,
    customerId: doc.customerId,
    relatedType: 'document',
    relatedId: doc.id,
    payloadJson: JSON.stringify({
      documentId: doc.id,
      filename: doc.originalName,
      fileType: doc.fileType,
      mimeType: doc.mimeType,
      size: doc.size,
      status: doc.status,
      fileUrl: toFileUrl(doc.filePath),
      thumbnailUrl: toThumbnailUrl(doc.thumbnailPath),
      summary: doc.aiSummary,
      confidence: doc.extractionConfidence,
      cardType: doc.fileType === 'price_sheet' ? 'price_sheet_review' : 'document_review',
      synthetic: true,
    }),
    createdAt: doc.createdAt,
    synthetic: true,
  }))

  return [...actionItems, ...docItems]
}
