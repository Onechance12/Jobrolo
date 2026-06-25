import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
export const runtime = 'nodejs'

type OnboardingMessage = { role: 'user' | 'assistant'; content: string; timestamp: string }

function buildProfile(companyName?: string | null) {
  return {
    companyName: companyName || undefined,
    services: [],
    serviceAreas: [],
    softwareUsed: [],
    goals: [],
    specialties: [],
  }
}

function buildGreeting(userName: string, companyName?: string | null): string {
  if (companyName) {
    return `Hey ${userName}, welcome to Jobrolo. There is a lot we can do together, but first let's get ${companyName} set up.\n\nAfter reviewing some information, this is what I was able to gather:\n\n- Company: ${companyName}\n- Account owner: ${userName}\n\nLet me know if any of this needs updating before moving forward. If it looks good, just let me know.`
  }
  return `Hey ${userName}, welcome to Jobrolo. There is a lot we can do together, but first let's get your company profile set up.\n\nWhat is your company website or business name?`
}

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const session = await db.onboardingSession.findUnique({ where: { contractorId: ctx.contractorId } })

  if (!session || JSON.parse(session.messagesJson || '[]').length === 0) {
    const companyName = ctx.contractor.company || ctx.contractor.name || null
    const userName = ctx.user.name || 'there'
    const confidence = companyName ? 15 : 0
    const history: OnboardingMessage[] = [{ role: 'assistant', content: buildGreeting(userName, companyName), timestamp: new Date().toISOString() }]

    console.log(`[onboarding] seeded profile from signup: contractor=${ctx.contractorId}`)

    if (!session) {
      await db.onboardingSession.create({
        data: {
          contractorId: ctx.contractorId,
          userId: ctx.user.id,
          status: 'in_progress',
          messagesJson: JSON.stringify(history),
          businessProfile: JSON.stringify(buildProfile(companyName)),
          coveredTopics: JSON.stringify(companyName ? ['company_identity'] : []),
          confidence,
        },
      })
    } else {
      await db.onboardingSession.update({
        where: { id: session.id },
        data: {
          messagesJson: JSON.stringify(history),
          businessProfile: JSON.stringify(buildProfile(companyName)),
          coveredTopics: JSON.stringify(companyName ? ['company_identity'] : []),
          confidence,
        },
      })
    }

    return NextResponse.json({ status: 'in_progress', confidence, messages: history })
  }

  return NextResponse.json({
    status: session.status,
    confidence: session.confidence,
    businessType: session.businessType,
    messages: JSON.parse(session.messagesJson || '[]'),
  })
}
