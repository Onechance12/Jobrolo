import { checkBodySize } from '@/lib/security/body-size'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext, audit } from '@/lib/security/context'
import { rateLimit } from '@/lib/security/rate-limit'
import { sanitizeUserInput } from '@/lib/security/prompt-defense'
import { enqueueAgentJob } from '@/lib/jobs/queue'
import { assertDocumentsBelongToTenant, normalizeIdList } from '@/lib/security/agent-execution'
import { hasCompanyWideAccess } from '@/lib/security/ownership'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr

  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!hasCompanyWideAccess(ctx)) return NextResponse.json({ error: 'Use your shared workspace chat.' }, { status: 403 })

  // Rate limit per contractor
  const rl = rateLimit(ctx.contractorId, '/api/chat')
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const body = await req.json().catch(() => ({}))
  const { message, displayMessage, conversationId, businessContext, history = [] } = body as any
  const documentIds = normalizeIdList((body as any).documentIds)

  // Allow empty message IF documents were uploaded — the user might just
  // upload a file with no text and expect the AI to read it.
  if (typeof message !== 'string') {
    return NextResponse.json({ error: 'message must be a string' }, { status: 400 })
  }
  if (!message.trim() && (!documentIds || documentIds.length === 0)) {
    return NextResponse.json({ error: 'message or document required' }, { status: 400 })
  }
  if (conversationId) {
    const conversation = await db.conversation.findFirst({ where: { id: String(conversationId), contractorId: ctx.contractorId }, select: { id: true } })
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }
  try {
    await assertDocumentsBelongToTenant(ctx.contractorId, documentIds)
  } catch {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // If message is empty but docs exist, use a default prompt
  const finalMessage = message.trim() || '(No text message — please review the uploaded document(s) and tell me what you found.)'
  const finalDisplayMessage = typeof displayMessage === 'string' && displayMessage.trim()
    ? displayMessage.trim()
    : finalMessage

  // Sanitize user input
  const sanitized = sanitizeUserInput(finalMessage)
  const sanitizedDisplay = sanitizeUserInput(finalDisplayMessage)
  if (sanitized.warnings.length > 0) {
    console.warn(`[chat] input warnings for ${ctx.actor}:`, sanitized.warnings)
  }

  const job = await enqueueAgentJob({
    contractorId: ctx.contractorId,
    userId: ctx.user.id,
    type: 'chat',
    input: { message: sanitized.text, displayMessage: sanitizedDisplay.text, conversationId, businessContext, documentIds, history },
    priority: 5,
  })

  await audit(ctx, 'ai_message', 'conversation', conversationId ?? null, `Sent message: ${sanitizedDisplay.text.slice(0, 100)}`, { jobId: job.id, documentIds }, req)
  return NextResponse.json({ jobId: job.id })
}
