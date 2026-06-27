import { db } from '@/lib/db'

/**
 * The old /onboarding route used to be a separate setup-mode chat before the
 * user could enter Jobrolo. Product direction changed: onboarding/setup should
 * happen inside the real Command Center so the user is not split between two
 * disconnected chats.
 *
 * This keeps the historical OnboardingSession record satisfied for existing
 * guards while making the main app the canonical setup surface.
 */
export async function markCommandCenterOnboardingReady(params: {
  contractorId: string
  userId: string
  companyName?: string | null
  website?: string | null
}) {
  const now = new Date()
  const company = params.companyName?.trim() || 'your company'
  const website = params.website?.trim()
  const greeting = [
    `Welcome to Jobrolo. Setup now continues inside the main Command Center for ${company}.`,
    website ? `Website from signup: ${website}` : null,
    'Jobrolo will surface company profile gaps, suggested setup prompts, and training inside the main chat instead of using a separate onboarding room.',
  ].filter(Boolean).join('\n\n')

  await db.onboardingSession.upsert({
    where: { contractorId: params.contractorId },
    create: {
      contractorId: params.contractorId,
      userId: params.userId,
      status: 'completed',
      confidence: 100,
      completedAt: now,
      coveredTopics: JSON.stringify(['command_center_entry']),
      businessProfile: JSON.stringify({
        companyName: params.companyName ?? null,
        website: params.website ?? null,
        setupSurface: 'command_center',
      }),
      messagesJson: JSON.stringify([
        { role: 'assistant', content: greeting, timestamp: now.toISOString() },
      ]),
    },
    update: {
      userId: params.userId,
      status: 'completed',
      confidence: 100,
      completedAt: now,
      businessProfile: JSON.stringify({
        companyName: params.companyName ?? null,
        website: params.website ?? null,
        setupSurface: 'command_center',
      }),
    },
  })
}
