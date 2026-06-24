import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { db } from '@/lib/db'
import { dispatchCommunicationMessage } from '@/lib/communications'

function canAdmin(role?: string | null) {
  return ['owner', 'admin', 'manager'].includes(String(role ?? '').toLowerCase())
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!canAdmin(ctx.user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const existing = await db.communicationMessage.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!existing) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  const message = await dispatchCommunicationMessage(id)
  return NextResponse.json({ message })
}
