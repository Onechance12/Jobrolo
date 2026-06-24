import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext, ForbiddenError } from '@/lib/security/context'
import { requireConversation } from '@/lib/security/ownership'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params

  // SECURITY: Use centralized ownership helper
  const owned = await requireConversation(ctx, id)
  if (!owned) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const convo = await db.conversation.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } })
  if (!convo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({
    conversation: { id: convo.id, title: convo.title, createdAt: convo.createdAt, updatedAt: convo.updatedAt },
    messages: convo.messages.map(m => ({
      id: m.id, role: m.role, content: m.content,
      contextType: m.contextType, contextData: m.contextData ? JSON.parse(m.contextData) : null,
      attachments: m.attachments ? JSON.parse(m.attachments) : null,
      actionResults: m.actionResults ? JSON.parse(m.actionResults) : null,
      createdAt: m.createdAt,
    })),
  })
}
