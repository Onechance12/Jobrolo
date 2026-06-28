import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { boundedLimit, requireDevBridge, safeJson } from '@/lib/dev-bridge'

export const runtime = 'nodejs'

const DEFAULT_ACTION_STATUSES = ['pending', 'needs_approval', 'routed']
const DEFAULT_INBOX_STATUSES = ['unread', 'read']

function statuses(value: string | null, fallback: string[]) {
  return (value ?? fallback.join(','))
    .split(',')
    .map(status => status.trim())
    .filter(Boolean)
}

export async function GET(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const limit = boundedLimit(url.searchParams.get('limit'), 50, 200)
  const actionStatuses = statuses(url.searchParams.get('actionStatus'), DEFAULT_ACTION_STATUSES)
  const inboxStatuses = statuses(url.searchParams.get('inboxStatus'), DEFAULT_INBOX_STATUSES)

  const [actionRequests, inboxItems, counts] = await Promise.all([
    db.actionRequest.findMany({
      where: { status: { in: actionStatuses } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        contractorId: true,
        projectId: true,
        customerId: true,
        requestedRole: true,
        type: true,
        title: true,
        summary: true,
        status: true,
        priority: true,
        payloadJson: true,
        dueAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.inboxItem.findMany({
      where: { status: { in: inboxStatuses } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        contractorId: true,
        projectId: true,
        customerId: true,
        role: true,
        type: true,
        title: true,
        summary: true,
        status: true,
        priority: true,
        actionRequestId: true,
        relatedType: true,
        relatedId: true,
        payloadJson: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    Promise.all([
      db.actionRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      db.inboxItem.groupBy({ by: ['status'], _count: { _all: true } }),
    ]),
  ])

  return NextResponse.json({
    status: 'ok',
    filters: { actionStatuses, inboxStatuses, limit },
    counts: {
      actionRequests: Object.fromEntries(counts[0].map(row => [row.status, row._count._all])),
      inboxItems: Object.fromEntries(counts[1].map(row => [row.status, row._count._all])),
    },
    actionRequests: actionRequests.map(item => ({
      ...item,
      payload: safeJson(item.payloadJson, null),
      payloadJson: undefined,
    })),
    inboxItems: inboxItems.map(item => ({
      ...item,
      payload: safeJson(item.payloadJson, null),
      payloadJson: undefined,
    })),
  })
}
