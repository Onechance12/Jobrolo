import { searchTwilioLocalNumbers, twilioPhoneProvisioningConfigured } from '@/lib/twilio'
import { requireContext, UnauthorizedError, ForbiddenError } from '@/lib/security/context'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req)
    if (!ctx.user || !['owner', 'admin', 'manager'].includes(ctx.user.role)) {
      throw new ForbiddenError('Only owner, admin, or manager roles can search company phone numbers')
    }
    const limited = rateLimitByIp(req, '/api/company-phone-numbers/search')
    if (limited) return limited
    if (!twilioPhoneProvisioningConfigured()) {
      return NextResponse.json({ error: 'Twilio phone provisioning is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.' }, { status: 503 })
    }
    const url = new URL(req.url)
    const areaCode = url.searchParams.get('areaCode')
    const contains = url.searchParams.get('contains')
    const limit = Number(url.searchParams.get('limit') || 10)
    const numbers = await searchTwilioLocalNumbers({ areaCode, contains, limit })
    return NextResponse.json({
      success: true,
      numbers,
      note: 'Searching does not buy a number. Provisioning requires owner/admin confirmation.',
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 })
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 })
    console.error('[company-phone-numbers/search] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not search Twilio numbers' }, { status: 500 })
  }
}
