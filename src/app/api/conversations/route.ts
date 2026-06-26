import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext, audit } from '@/lib/security/context'
import { hasCompanyWideAccess } from '@/lib/security/ownership'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!hasCompanyWideAccess(ctx)) return NextResponse.json({ conversations: [] })

  const convos = await db.conversation.findMany({
    where: { contractorId: ctx.contractorId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, createdAt: true } },
      _count: { select: { messages: true } },
    },
  })
  return NextResponse.json({
    conversations: convos.map(c => ({
      id: c.id, title: c.title ?? 'New Chat',
      preview: c.messages[0]?.content?.slice(0, 120) ?? '',
      messageCount: c._count.messages,
      createdAt: c.createdAt, updatedAt: c.updatedAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!hasCompanyWideAccess(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title } = await req.json().catch(() => ({}))
  const convo = await db.conversation.create({ data: { contractorId: ctx.contractorId, title: title || 'New Chat' } })
  await audit(ctx, 'create', 'conversation', convo.id, `Created conversation: ${convo.title}`, null, req)
  return NextResponse.json({ conversation: convo })
}
