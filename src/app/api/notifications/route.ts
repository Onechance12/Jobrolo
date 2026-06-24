import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { createRoleNotification, listNotifications } from '@/lib/notifications'

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
  return NextResponse.json(notifications)
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
