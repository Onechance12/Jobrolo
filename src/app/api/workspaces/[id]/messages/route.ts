import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id: workspaceId } = await params
  const chatId = new URL(req.url).searchParams.get('chatId')
  if (!chatId) return NextResponse.json({ messages: [] })

  // SECURITY: Verify workspace belongs to this contractor
  const ws = await db.workspace.findFirst({
    where: { id: workspaceId, contractorId: ctx.contractorId },
    select: { id: true },
  })
  if (!ws) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // SECURITY: Verify the chat belongs to THIS workspace (prevents chat ID mixing)
  const chat = await db.workspaceChat.findFirst({
    where: { id: chatId, workspaceId },
    select: { id: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const msgs = await db.workspaceMessage.findMany({ where: { chatId }, orderBy: { createdAt: 'asc' }, take: 200 })
  return NextResponse.json({
    messages: msgs.map(m => ({
      id: m.id, role: m.role, content: m.content,
      contextType: m.contextType,
      contextData: m.contextData ? JSON.parse(m.contextData) : null,
      attachments: m.attachments ? JSON.parse(m.attachments) : null,
      actionResults: m.actionResults ? JSON.parse(m.actionResults) : null,
      createdAt: m.createdAt,
    })),
  })
}
