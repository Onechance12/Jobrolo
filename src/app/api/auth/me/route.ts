import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getContext } from '@/lib/security/context'
import { markCommandCenterOnboardingReady } from '@/lib/onboarding/command-center-ready'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx || !ctx.user) {
    return NextResponse.json({ user: null, contractor: null, authenticated: false })
  }

  // Setup now continues in the main Command Center. If an older account still
  // has an incomplete/no onboarding session, self-heal it here so refreshes do
  // not route the user back into the retired setup-mode chat.
  const onboarding = await db.onboardingSession.findUnique({ where: { contractorId: ctx.contractorId } })
  if (!onboarding || onboarding.status !== 'completed') {
    await markCommandCenterOnboardingReady({
      contractorId: ctx.contractorId,
      userId: ctx.user.id,
      companyName: ctx.contractor.company || ctx.contractor.name,
    })
  }

  return NextResponse.json({
    authenticated: true,
    user: ctx.user,
    contractor: ctx.contractor,
    onboardingComplete: true,
    redirectTo: '/',
  })
}
