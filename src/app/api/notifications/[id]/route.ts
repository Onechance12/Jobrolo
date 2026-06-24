import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { markNotification } from '@/lib/notifications'

const PatchSchema = z.object({ status: z.enum(['read', 'unread', 'actioned', 'archived']) })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const item = await markNotification(ctx, id, parsed.data.status)
  if (!item) return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
  return NextResponse.json({ notification: item })
}
