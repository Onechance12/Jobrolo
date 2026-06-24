import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext, audit } from '@/lib/security/context'
import { rateLimit } from '@/lib/security/rate-limit'
import { sanitizeUserInput } from '@/lib/security/prompt-defense'
import { enqueueAgentJob } from '@/lib/jobs/queue'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id: workspaceId } = await params

  // Verify workspace ownership
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { contractorId: true } })
  if (!ws || ws.contractorId !== ctx.contractorId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const rl = rateLimit(ctx.contractorId, '/api/workspaces/[id]/chat')
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  const { chatId, message, documentIds = [], history = [] } = await req.json().catch(() => ({}))
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 })

  // Allow empty message IF documents were uploaded
  if (typeof message !== 'string') return NextResponse.json({ error: 'message must be a string' }, { status: 400 })
  if (!message.trim() && (!documentIds || documentIds.length === 0)) {
    return NextResponse.json({ error: 'message or document required' }, { status: 400 })
  }

  // If message is empty but docs exist, use a default prompt
  const finalMessage = message.trim() || '(No text message — please review the uploaded document(s) and tell me what you found.)'

  // Verify chat belongs to workspace
  const chat = await db.workspaceChat.findFirst({ where: { id: chatId, workspaceId }, select: { id: true, chatType: true } })
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const sanitized = sanitizeUserInput(finalMessage)
  const job = await enqueueAgentJob({
    contractorId: ctx.contractorId,
    userId: ctx.user?.id,
    type: 'workspace_chat',
    input: { message: sanitized.text, documentIds, history, workspaceId, chatId },
    workspaceId,
    chatId,
    priority: 5,
  })

  await audit(ctx, 'ai_message', 'workspace_chat', chatId, `[${chat.chatType}] ${sanitized.text.slice(0, 100)}`, { jobId: job.id, workspaceId }, req)
  return NextResponse.json({ jobId: job.id })
}
