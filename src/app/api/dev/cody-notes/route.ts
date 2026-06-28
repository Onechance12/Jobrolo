import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { checkBodySize } from '@/lib/security/body-size'

export const runtime = 'nodejs'

const QuerySchema = z.object({
  status: z.string().optional().default('unread,read'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})

const PatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  status: z.enum(['read', 'unread', 'actioned', 'archived']),
  resolution: z.string().max(2000).optional(),
})

function tokenFromRequest(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return req.headers.get('x-cody-bridge-token')?.trim() ?? ''
}

function authorized(req: NextRequest) {
  const configured = process.env.CODY_BRIDGE_TOKEN?.trim()
  const supplied = tokenFromRequest(req)
  if (!configured || !supplied) return false
  const configuredBuffer = Buffer.from(configured)
  const suppliedBuffer = Buffer.from(supplied)
  if (configuredBuffer.length !== suppliedBuffer.length) return false
  return timingSafeEqual(configuredBuffer, suppliedBuffer)
}

function safePayload(payloadJson: string | null) {
  if (!payloadJson) return null
  try {
    return JSON.parse(payloadJson) as Record<string, unknown>
  } catch {
    return null
  }
}

function responseUnauthorized() {
  const message = process.env.CODY_BRIDGE_TOKEN
    ? 'Unauthorized'
    : 'Cody bridge is not configured. Set CODY_BRIDGE_TOKEN in the environment.'
  return NextResponse.json({ error: message }, { status: process.env.CODY_BRIDGE_TOKEN ? 401 : 503 })
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return responseUnauthorized()

  const sp = Object.fromEntries(new URL(req.url).searchParams.entries())
  const parsed = QuerySchema.safeParse(sp)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const statuses = parsed.data.status
    .split(',')
    .map(status => status.trim())
    .filter(Boolean)

  const items = await db.inboxItem.findMany({
    where: {
      type: 'tester_feedback',
      ...(statuses.length ? { status: { in: statuses } } : {}),
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: parsed.data.limit,
  })

  const contractorIds = [...new Set(items.map(item => item.contractorId))]
  const userIds = [...new Set(items.map(item => item.userId).filter((id): id is string => Boolean(id)))]
  const [contractors, users] = await Promise.all([
    db.contractor.findMany({
      where: { id: { in: contractorIds } },
      select: { id: true, company: true, name: true, email: true },
    }),
    db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, role: true },
    }),
  ])
  const contractorById = new Map(contractors.map(contractor => [contractor.id, contractor]))
  const userById = new Map(users.map(user => [user.id, user]))

  return NextResponse.json({
    count: items.length,
    items: items.map(item => {
      const payload = safePayload(item.payloadJson)
      const contractor = contractorById.get(item.contractorId)
      const user = item.userId ? userById.get(item.userId) : null
      return {
        id: item.id,
        contractorId: item.contractorId,
        company: contractor?.company ?? contractor?.name ?? null,
        contractorEmail: contractor?.email ?? null,
        capturedBy: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null,
        title: item.title,
        summary: item.summary,
        content: typeof payload?.content === 'string' ? payload.content : item.summary,
        area: typeof payload?.area === 'string' ? payload.area : null,
        severity: typeof payload?.severity === 'string' ? payload.severity : item.priority,
        currentUrl: typeof payload?.currentUrl === 'string' ? payload.currentUrl : null,
        status: item.status,
        priority: item.priority,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        actionedAt: item.actionedAt,
        payload,
      }
    }),
  })
}

export async function PATCH(req: NextRequest) {
  if (!authorized(req)) return responseUnauthorized()

  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const now = new Date()
  const existing = await db.inboxItem.findMany({
    where: { id: { in: parsed.data.ids }, type: 'tester_feedback' },
    select: { id: true, payloadJson: true },
  })

  await db.$transaction(existing.map(item => {
    const payload = {
      ...(safePayload(item.payloadJson) ?? {}),
      codyStatus: parsed.data.status,
      codyResolution: parsed.data.resolution ?? null,
      codyHandledAt: ['actioned', 'archived'].includes(parsed.data.status) ? now.toISOString() : null,
    }
    return db.inboxItem.update({
      where: { id: item.id },
      data: {
        status: parsed.data.status,
        payloadJson: JSON.stringify(payload),
        ...(parsed.data.status === 'read' ? { readAt: now } : {}),
        ...(['actioned', 'archived'].includes(parsed.data.status) ? { actionedAt: now } : {}),
      },
    })
  }))

  return NextResponse.json({
    success: true,
    requested: parsed.data.ids.length,
    updated: existing.length,
    status: parsed.data.status,
  })
}
