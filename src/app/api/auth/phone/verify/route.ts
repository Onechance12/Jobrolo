import { checkBodySize } from '@/lib/security/body-size'
import { db } from '@/lib/db'
import { bootstrapTenant } from '@/lib/security/bootstrap'
import { audit } from '@/lib/security/context'
import { normalizePhoneE164, phoneOnlyEmail } from '@/lib/phone'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { issueSession, setSessionCookie } from '@/lib/security/session'
import { checkTwilioVerify, twilioVerifyConfigured } from '@/lib/twilio'
import { markCommandCenterOnboardingReady } from '@/lib/onboarding/command-center-ready'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type VerifyBody = {
  phone?: string
  code?: string
  name?: string
  companyName?: string
  website?: string
  email?: string
}

export async function POST(req: NextRequest) {
  try {
    const sizeError = checkBodySize(req)
    if (sizeError) return sizeError
    const limited = rateLimitByIp(req, '/api/auth/phone/verify')
    if (limited) return limited

    const body = await req.json() as VerifyBody
    const normalized = normalizePhoneE164(body.phone)
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })
    if (!body.code || body.code.trim().length < 4) return NextResponse.json({ error: 'Verification code is required' }, { status: 400 })
    if (!twilioVerifyConfigured()) {
      return NextResponse.json({ error: 'Phone verification is not configured yet. Add TWILIO_VERIFY_SERVICE_SID and Twilio credentials.' }, { status: 503 })
    }

    const verified = await checkTwilioVerify(normalized.e164, body.code)
    if (!verified.ok) return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 401 })

    const existing = await db.user.findFirst({
      where: {
        OR: [
          { phoneE164: normalized.e164 },
          { phone: normalized.e164 },
          { phone: normalized.national },
        ],
      },
      include: { contractor: true },
    })
    if (existing) {
      return await loginPhoneUser(req, existing, verified.sid, {
        e164: normalized.e164,
        national: normalized.national,
      })
    }

    const name = body.name?.trim()
    const companyName = body.companyName?.trim()
    if (!name || name.length < 2 || !companyName || companyName.length < 2) {
      return NextResponse.json({
        success: false,
        needsSignup: true,
        phoneE164: normalized.e164,
        phoneDisplay: normalized.national,
        message: 'Phone verified. Tell me your name and company name to create the workspace.',
      })
    }

    const requestedEmail = body.email?.trim().toLowerCase()
    const email = requestedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)
      ? requestedEmail
      : phoneOnlyEmail(normalized.e164)

    const emailExisting = await db.user.findUnique({ where: { email } })
    if (emailExisting) return NextResponse.json({ error: 'An account with this email already exists. Sign in or use a different email.' }, { status: 409 })

    const { userId, contractorId } = await bootstrapTenant({
      name,
      email,
      companyName,
      website: body.website?.trim() || undefined,
      phone: normalized.national,
      phoneE164: normalized.e164,
      phoneVerifiedAt: new Date(),
    })

    const user = await db.user.findUnique({ where: { id: userId }, include: { contractor: true } })
    if (!user) throw new Error('User creation failed')

    await markCommandCenterOnboardingReady({
      contractorId,
      userId,
      companyName,
      website: body.website?.trim() || undefined,
    })

    return await issuePhoneSession(req, user, 'phone_signup', verified.sid)
  } catch (err) {
    console.error('[auth/phone/verify] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Phone verification failed' }, { status: 500 })
  }
}

async function loginPhoneUser(
  req: NextRequest,
  user: any,
  verificationSid: string | null,
  verifiedPhone: { e164: string; national: string },
) {
  if (user.status !== 'active' || user.deletedAt) {
    return NextResponse.json({ error: 'Account is not active. Contact support.' }, { status: 403 })
  }
  if (!user.contractor || user.contractor.status !== 'active' || user.contractor.deletedAt) {
    return NextResponse.json({ error: 'Company account is not active. Contact support.' }, { status: 403 })
  }
  await db.user.update({
    where: { id: user.id },
    data: {
      phoneVerifiedAt: user.phoneVerifiedAt || new Date(),
      phone: user.phone || verifiedPhone.national,
      phoneE164: user.phoneE164 || verifiedPhone.e164,
      lastLoginAt: new Date(),
      lastLoginIp: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    },
  })
  await markCommandCenterOnboardingReady({
    contractorId: user.contractorId,
    userId: user.id,
    companyName: user.contractor.company || user.contractor.name,
  })
  return await issuePhoneSession(req, user, 'phone_login', verificationSid)
}

async function issuePhoneSession(req: NextRequest, user: any, auditAction: 'phone_login' | 'phone_signup', verificationSid: string | null) {
  const token = await issueSession({
    sub: user.id,
    cid: user.contractorId,
    email: user.email,
    role: user.role,
    name: user.name,
    tv: user.tokenVersion ?? 0,
  })
  const res = NextResponse.json({
    success: true,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phoneE164 || user.phone, role: user.role },
    contractor: { id: user.contractor.id, name: user.contractor.name, company: user.contractor.company },
    redirectTo: '/',
  })
  setSessionCookie(res, token)
  await audit(
    { contractorId: user.contractorId, user: { id: user.id, contractorId: user.contractorId, name: user.name, email: user.email, role: user.role, status: user.status }, actor: `user:${user.email}`, authMethod: 'session', contractor: { id: user.contractor.id, name: user.contractor.name, company: user.contractor.company, plan: user.contractor.plan, subscriptionStatus: (user.contractor as any).subscriptionStatus, status: user.contractor.status } },
    auditAction,
    'user',
    user.id,
    auditAction === 'phone_signup' ? `Phone signup: ${user.phoneE164 || user.phone}` : `Phone login: ${user.phoneE164 || user.phone}`,
    { verificationSid },
    req,
  )
  return res
}
