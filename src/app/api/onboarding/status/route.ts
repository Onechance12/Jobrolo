import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
export const runtime = 'nodejs'

type OnboardingMessage = { role: 'user' | 'assistant'; content: string; timestamp: string }

function websiteFromMemory(content?: string | null): string | undefined {
  const prefix = 'Company website:'
  if (!content?.startsWith(prefix)) return undefined
  return content.slice(prefix.length).trim() || undefined
}

function buildProfile(companyName?: string | null, website?: string | null) {
  return {
    companyName: companyName || undefined,
    website: website || undefined,
    services: [],
    serviceAreas: [],
    softwareUsed: [],
    goals: [],
    specialties: [],
  }
}

function buildGreeting(userName: string, companyName?: string | null, website?: string | null): string {
  const setupMode = `You’re in Jobrolo setup mode right now. I can explain how to use Jobrolo before we start, or we can finish your company profile. I won’t create jobs, chats, files, or customer records until onboarding is complete.`
  if (companyName) {
    const facts = [
      `- Company: ${companyName}`,
      website ? `- Website: ${website}` : null,
      `- Account owner: ${userName}`,
    ].filter(Boolean).join('\n')
    return `Hey ${userName}, welcome to Jobrolo.\n\n${setupMode}\n\nHere’s what I already have:\n\n${facts}\n\nFirst, what is your role with ${companyName} — owner/admin, sales, project manager, crew/sub, office, customer, or something else? If you were invited to someone else’s company, use that invite link instead of creating a new company workspace.`
  }
  if (website) {
    return `Hey ${userName}, welcome to Jobrolo.\n\n${setupMode}\n\nI found this website from signup: ${website}. What company name should I use for your workspace, and what is your role there? If you were invited to an existing company, use your invite link instead.`
  }
  return `Hey ${userName}, welcome to Jobrolo.\n\n${setupMode}\n\nAre you creating a new company workspace, or joining a company you were invited to? If you’re creating one, tell me your company website or business name and your role.`
}

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const session = await db.onboardingSession.findUnique({ where: { contractorId: ctx.contractorId } })

  if (!session || JSON.parse(session.messagesJson || '[]').length === 0) {
    const websiteMemory = await db.contractorMemory.findFirst({
      where: {
        contractorId: ctx.contractorId,
        content: { startsWith: 'Company website:' },
      },
      orderBy: { createdAt: 'asc' },
    })
    const companyName = ctx.contractor.company || null
    const website = websiteFromMemory(websiteMemory?.content)
    const userName = ctx.user.name || 'there'
    const confidence = (companyName ? 15 : 0) + (website ? 5 : 0)
    const history: OnboardingMessage[] = [{ role: 'assistant', content: buildGreeting(userName, companyName, website), timestamp: new Date().toISOString() }]

    console.log(`[onboarding] seeded profile from signup: contractor=${ctx.contractorId}`)

    if (!session) {
      await db.onboardingSession.create({
        data: {
          contractorId: ctx.contractorId,
          userId: ctx.user.id,
          status: 'in_progress',
          messagesJson: JSON.stringify(history),
          businessProfile: JSON.stringify(buildProfile(companyName, website)),
          coveredTopics: JSON.stringify(companyName ? ['company_identity'] : []),
          confidence,
        },
      })
    } else {
      await db.onboardingSession.update({
        where: { id: session.id },
        data: {
          messagesJson: JSON.stringify(history),
          businessProfile: JSON.stringify(buildProfile(companyName, website)),
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
