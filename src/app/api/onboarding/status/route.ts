import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { markCommandCenterOnboardingReady } from '@/lib/onboarding/command-center-ready'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message, redirectTo: '/' }, { status: 401 })
  if (!ctx.user) return NextResponse.json({ error: 'Authentication required', redirectTo: '/' }, { status: 401 })

  await markCommandCenterOnboardingReady({
    contractorId: ctx.contractorId,
    userId: ctx.user.id,
    companyName: ctx.contractor.company || ctx.contractor.name,
  })

  return NextResponse.json({
    status: 'completed',
    confidence: 100,
    messages: [],
    redirectTo: '/',
    message: 'Setup now continues in the main Jobrolo Command Center.',
  })
}
