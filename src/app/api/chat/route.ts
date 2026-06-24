import { checkBodySize } from '@/lib/security/body-size'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext, audit } from '@/lib/security/context'
import { rateLimit } from '@/lib/security/rate-limit'
import { sanitizeUserInput } from '@/lib/security/prompt-defense'
import { enqueueAgentJob } from '@/lib/jobs/queue'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  // Rate limit per contractor
  const rl = rateLimit(ctx.contractorId, '/api/chat')
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const body = await req.json().catch(() => ({}))
  const { message, conversationId, businessContext, documentIds = [], history = [] } = body as any

  // Allow empty message IF documents were uploaded — the user might just
  // upload a file with no text and expect the AI to read it.
  if (typeof message !== 'string') {
    return NextResponse.json({ error: 'message must be a string' }, { status: 400 })
  }
  if (!message.trim() && (!documentIds || documentIds.length === 0)) {
    return NextResponse.json({ error: 'message or document required' }, { status: 400 })
  }

  // If message is empty but docs exist, use a default prompt
  const finalMessage = message.trim() || '(No text message — please review the uploaded document(s) and tell me what you found.)'

  // Sanitize user input
  const sanitized = sanitizeUserInput(finalMessage)
  if (sanitized.warnings.length > 0) {
    console.warn(`[chat] input warnings for ${ctx.actor}:`, sanitized.warnings)
  }

  const job = await enqueueAgentJob({
    contractorId: ctx.contractorId,
    userId: ctx.user?.id,
    type: 'chat',
    input: { message: sanitized.text, conversationId, businessContext, documentIds, history },
    priority: 5,
  })

  await audit(ctx, 'ai_message', 'conversation', conversationId ?? null, `Sent message: ${sanitized.text.slice(0, 100)}`, { jobId: job.id, documentIds }, req)
  return NextResponse.json({ jobId: job.id })
}
