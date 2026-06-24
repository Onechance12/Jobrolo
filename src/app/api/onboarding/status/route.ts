import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { getInitialGreeting } from '@/lib/onboarding/agent'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const session = await db.onboardingSession.findUnique({ where: { contractorId: ctx.contractorId } })

  // No session yet — return the initial greeting
  if (!session || JSON.parse(session.messagesJson || '[]').length === 0) {
    const { message, history } = await getInitialGreeting(ctx.contractorId, ctx.user.id)
    return NextResponse.json({
      status: 'in_progress',
      confidence: 0,
      messages: history,
    })
  }

  return NextResponse.json({
    status: session.status,
    confidence: session.confidence,
    businessType: session.businessType,
    messages: JSON.parse(session.messagesJson || '[]'),
  })
}
