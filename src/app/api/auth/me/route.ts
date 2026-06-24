import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getContext } from '@/lib/security/context'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx || !ctx.user) {
    return NextResponse.json({ user: null, contractor: null, authenticated: false })
  }

  // Check onboarding status — a user with NO onboarding session is NOT onboarded yet
  const onboarding = await db.onboardingSession.findUnique({ where: { contractorId: ctx.contractorId } })
  const onboardingComplete = !!onboarding && onboarding.status === 'completed'

  return NextResponse.json({
    authenticated: true,
    user: ctx.user,
    contractor: ctx.contractor,
    onboardingComplete,
    redirectTo: onboardingComplete ? '/' : '/onboarding',
  })
}
