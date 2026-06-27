import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { markCommandCenterOnboardingReady } from '@/lib/onboarding/command-center-ready'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) {
    return NextResponse.json({
      message: 'Open the Jobrolo Command Center to continue setup.',
      completed: true,
      redirectTo: '/',
      error: ctx.message,
    }, { status: 401 })
  }
  if (!ctx.user) {
    return NextResponse.json({
      message: 'Open the Jobrolo Command Center to continue setup.',
      completed: true,
      redirectTo: '/',
      error: 'Authentication required',
    }, { status: 401 })
  }

  await markCommandCenterOnboardingReady({
    contractorId: ctx.contractorId,
    userId: ctx.user.id,
    companyName: ctx.contractor.company || ctx.contractor.name,
  })

  return NextResponse.json({
    message: 'Setup now continues in the main Jobrolo Command Center. You can finish your company profile, ask how Jobrolo works, upload documents, or start using the normal chat.',
    confidence: 100,
    completed: true,
    researchRan: false,
    redirectTo: '/',
  })
}
