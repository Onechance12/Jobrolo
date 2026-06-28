import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { boundedLimit, minutesAgo, requireDevBridge, safeJson } from '@/lib/dev-bridge'
import { getDeployInfo } from '@/lib/deploy-info'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const limit = boundedLimit(url.searchParams.get('limit'), 50, 200)
  const since = minutesAgo(url.searchParams.get('minutes'), 60)

  const [jobs, documents, actions, inbox] = await Promise.all([
    db.agentJob.findMany({
      where: {
        createdAt: { gte: since },
        OR: [{ status: { in: ['error', 'cancelled'] } }, { error: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, type: true, status: true, heartbeat: true, error: true, inputJson: true, createdAt: true, updatedAt: true },
    }),
    db.document.findMany({
      where: {
        createdAt: { gte: since },
        OR: [{ status: { in: ['failed', 'needs_ocr', 'processing', 'pending_review'] } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, originalName: true, fileType: true, status: true, aiSummary: true, extractionConfidence: true, customerId: true, projectId: true, createdAt: true },
    }),
    db.actionRequest.findMany({
      where: { createdAt: { gte: since }, status: { in: ['pending', 'needs_approval', 'routed'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, type: true, title: true, status: true, priority: true, projectId: true, customerId: true, createdAt: true, updatedAt: true },
    }),
    db.inboxItem.findMany({
      where: { createdAt: { gte: since }, status: { in: ['unread', 'read'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, contractorId: true, type: true, title: true, status: true, priority: true, actionRequestId: true, payloadJson: true, createdAt: true, updatedAt: true },
    }),
  ])

  return NextResponse.json({
    status: 'ok',
    note: 'This endpoint reports Jobrolo-owned operational signals from the database. Raw Render stdout/stderr should stay in the local Render bridge, not exposed through production.',
    deploy: getDeployInfo(),
    filters: { since, limit },
    signals: {
      failedOrCancelledJobs: jobs.map(job => ({ ...job, input: safeJson(job.inputJson, null), inputJson: undefined })),
      reviewOrProblemDocuments: documents,
      openActionRequests: actions,
      openInboxItems: inbox.map(item => ({ ...item, payload: safeJson(item.payloadJson, null), payloadJson: undefined })),
    },
  })
}
