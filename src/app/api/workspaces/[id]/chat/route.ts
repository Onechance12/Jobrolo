import { NextRequest, NextResponse } from 'next/server'
import { requireContext, audit } from '@/lib/security/context'
import { rateLimit } from '@/lib/security/rate-limit'
import { sanitizeUserInput } from '@/lib/security/prompt-defense'
import { enqueueAgentJob } from '@/lib/jobs/queue'
import { checkBodySize } from '@/lib/security/body-size'
import { requireWorkspace, requireWorkspaceChat } from '@/lib/security/ownership'
import { assertDocumentsBelongToTenant, normalizeIdList } from '@/lib/security/agent-execution'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr

  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id: workspaceId } = await params

  // Verify workspace ownership
  const ws = await requireWorkspace(ctx, workspaceId)
  if (!ws) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const rl = rateLimit(ctx.contractorId, '/api/workspaces/[id]/chat')
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  const body = await req.json().catch(() => ({}))
  const { chatId, message, displayMessage, history = [] } = body
  const documentIds = normalizeIdList(body.documentIds)
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 })

  // Allow empty message IF documents were uploaded
  if (typeof message !== 'string') return NextResponse.json({ error: 'message must be a string' }, { status: 400 })
  if (!message.trim() && (!documentIds || documentIds.length === 0)) {
    return NextResponse.json({ error: 'message or document required' }, { status: 400 })
  }

  // If message is empty but docs exist, use a default prompt
  const finalMessage = message.trim() || '(No text message — please review the uploaded document(s) and tell me what you found.)'
  const finalDisplayMessage = typeof displayMessage === 'string' && displayMessage.trim()
    ? displayMessage.trim()
    : finalMessage

  // Verify chat belongs to workspace
  const chat = await requireWorkspaceChat(ctx, workspaceId, String(chatId))
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  try {
    await assertDocumentsBelongToTenant(ctx.contractorId, documentIds)
  } catch {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const sanitized = sanitizeUserInput(finalMessage)
  const sanitizedDisplay = sanitizeUserInput(finalDisplayMessage)
  const job = await enqueueAgentJob({
    contractorId: ctx.contractorId,
    userId: ctx.user.id,
    type: 'workspace_chat',
    input: { message: sanitized.text, displayMessage: sanitizedDisplay.text, documentIds, history, workspaceId, chatId },
    workspaceId,
    chatId,
    priority: 5,
  })

  await audit(ctx, 'ai_message', 'workspace_chat', chatId, `[${chat.chatType}] ${sanitizedDisplay.text.slice(0, 100)}`, { jobId: job.id, workspaceId }, req)
  return NextResponse.json({ jobId: job.id })
}
