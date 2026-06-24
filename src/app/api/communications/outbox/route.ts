import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { db } from '@/lib/db'
import { dispatchQueuedCommunications } from '@/lib/communications'

function canAdmin(role?: string | null) {
  return ['owner', 'admin', 'manager'].includes(String(role ?? '').toLowerCase())
}

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!canAdmin(ctx.user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = new URL(req.url).searchParams
  const status = sp.get('status') ?? undefined
  const channel = sp.get('channel') ?? undefined
  const messages = await db.communicationMessage.findMany({
    where: { contractorId: ctx.contractorId, ...(status ? { status } : {}), ...(channel ? { channel } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(sp.get('limit') ?? 100), 1), 250),
  })
  return NextResponse.json({ messages })
}

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!canAdmin(ctx.user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await dispatchQueuedCommunications(50)
  return NextResponse.json(result)
}
