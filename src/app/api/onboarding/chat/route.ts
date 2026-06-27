import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { processOnboardingTurn } from '@/lib/onboarding/agent'
export const runtime = 'nodejs'
export const maxDuration = 60

type OnboardingMessage = { role: 'user' | 'assistant'; content: string; timestamp: string }

const FALLBACK_MESSAGE = "I hit a setup hiccup, but we can keep onboarding without guessing. In one sentence, are you mostly retail roofing, insurance/storm work, commercial work, or a mix?"

async function persistFallbackTurn(contractorId: string, userId: string, userMessage: string, assistantMessage: string) {
  try {
    const session = await db.onboardingSession.upsert({
      where: { contractorId },
      update: { status: 'in_progress' },
      create: { contractorId, userId, status: 'in_progress' },
    })
    const history: OnboardingMessage[] = JSON.parse(session.messagesJson || '[]')
    const last = history[history.length - 1]
    if (!(last?.role === 'user' && last.content === userMessage)) {
      history.push({ role: 'user', content: userMessage, timestamp: new Date().toISOString() })
    }
    history.push({ role: 'assistant', content: assistantMessage, timestamp: new Date().toISOString() })
    const confidence = Math.max(session.confidence || 0, 20)
    await db.onboardingSession.update({
      where: { id: session.id },
      data: {
        messagesJson: JSON.stringify(history.slice(-30)),
        confidence,
      },
    })
    return confidence
  } catch (err) {
    console.error('[onboarding/chat] fallback persistence failed:', err)
    return 20
  }
}

export async function POST(req: NextRequest) {
  console.log('[onboarding/chat] request received')

  try {
    const ctx = await requireContext(req).catch(e => e)
    if (ctx instanceof Error) {
      console.error('[onboarding/chat] auth failed:', ctx)
      return NextResponse.json({
        message: 'Your session expired. Please log in again, then continue onboarding.',
        error: ctx.message,
        completed: false,
        researchRan: false,
      }, { status: 401 })
    }
    if (!ctx.user) {
      return NextResponse.json({
        message: 'Your session expired. Please log in again, then continue onboarding.',
        error: 'Authentication required',
        completed: false,
        researchRan: false,
      }, { status: 401 })
    }

    const body = await req.json().catch(err => {
      console.error('[onboarding/chat] invalid JSON body:', err)
      return null
    }) as { message?: string } | null

    const message = body?.message?.trim()
    if (!message) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 })
    }

    try {
      const result = await processOnboardingTurn({
        contractorId: ctx.contractorId,
        userId: ctx.user.id,
        userMessage: message,
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
      const confidence = await persistFallbackTurn(ctx.contractorId, ctx.user.id, message, FALLBACK_MESSAGE)
      return NextResponse.json({
        message: FALLBACK_MESSAGE,
        confidence,
        completed: false,
        researchRan: false,
        fallback: true,
      })
    }
  } catch (err) {
    console.error('[onboarding/chat] fatal error:', err)
    return NextResponse.json({
      message: 'I hit an onboarding error, but the app is still running. Refresh once and try again.',
      confidence: 0,
      completed: false,
      researchRan: false,
      fallback: true,
    })
  }
}
