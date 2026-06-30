import { checkBodySize } from '@/lib/security/body-size'
import { normalizePhoneE164 } from '@/lib/phone'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { startTwilioVerify, twilioVerifyConfigured } from '@/lib/twilio'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const sizeError = checkBodySize(req)
    if (sizeError) return sizeError
    const limited = rateLimitByIp(req, '/api/auth/phone/start')
    if (limited) return limited

    const { phone } = await req.json() as { phone?: string }
    const normalized = normalizePhoneE164(phone)
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })
    if (!twilioVerifyConfigured()) {
      return NextResponse.json({ error: 'Phone verification is not configured yet. Add TWILIO_VERIFY_SERVICE_SID and Twilio credentials.' }, { status: 503 })
    }

    await startTwilioVerify(normalized.e164)
    return NextResponse.json({ success: true, phoneE164: normalized.e164, phoneDisplay: normalized.national })
  } catch (err) {
    console.error('[auth/phone/start] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not send verification code' }, { status: 500 })
  }
}
