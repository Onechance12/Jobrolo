import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { processOnboardingTurn } from '@/lib/onboarding/agent'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  console.log('[onboarding/chat] request received')
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { message } = await req.json() as { message?: string }
  if (!message || !message.trim()) {
    return NextResponse.json({ error: 'Message required' }, { status: 400 })
  }

  try {
    const result = await processOnboardingTurn({
      contractorId: ctx.contractorId,
      userId: ctx.user.id,
      userMessage: message.trim(),
    })

    return NextResponse.json({
      message: result.agentMessage,
      confidence: result.confidence,
      completed: result.completed,
      researchRan: result.researchRan,
      redirectTo: result.completed ? '/' : undefined,
    })
  } catch (err) {
    console.error('[onboarding/chat] process failed:', err)
    return NextResponse.json({
      message: "Got it. I saved that detail. Are you mostly doing retail work, insurance or storm work, or both?",
      confidence: 15,
      completed: false,
      researchRan: false,
      fallback: true,
    })
  }
}
