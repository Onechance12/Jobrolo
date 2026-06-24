import { checkBodySize } from '@/lib/security/body-size'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/security/password'
import { issueSession, setSessionCookie } from '@/lib/security/session'
import { audit } from '@/lib/security/context'
import { rateLimitByIp } from '@/lib/security/rate-limit'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const sizeError = checkBodySize(req)
    if (sizeError) return sizeError
    // Rate limit: 5 attempts per 3 minutes per IP
    const limited = rateLimitByIp(req, '/api/auth/login')
    if (limited) return limited

    const { email, password } = await req.json() as { email?: string; password?: string }

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { contractor: true },
    })

    // Use the same error message for both "no user" and "wrong password" to prevent enumeration
    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    if (user.status !== 'active' || user.deletedAt) {
      return NextResponse.json({ error: 'Account is not active. Contact support.' }, { status: 403 })
    }
    if (!user.contractor || user.contractor.status !== 'active' || user.contractor.deletedAt) {
      return NextResponse.json({ error: 'Company account is not active. Contact support.' }, { status: 403 })
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Update last login
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null },
    })

    // Issue session with tokenVersion for invalidation
    const token = await issueSession({
      sub: user.id,
      cid: user.contractorId,
      email: user.email,
      role: user.role,
      name: user.name,
      tv: user.tokenVersion ?? 0,
    })

    // Check onboarding status to decide redirect
    const onboarding = await db.onboardingSession.findUnique({ where: { contractorId: user.contractorId } })
    const onboardingComplete = !!onboarding && onboarding.status === 'completed'
    const redirectTo = onboardingComplete ? '/' : '/onboarding'

    const res = NextResponse.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      contractor: { id: user.contractor.id, name: user.contractor.name, company: user.contractor.company },
      redirectTo,
    })
    setSessionCookie(res, token)

    await audit(
      { contractorId: user.contractorId, user: { id: user.id, contractorId: user.contractorId, name: user.name, email: user.email, role: user.role, status: user.status }, actor: `user:${user.email}`, authMethod: 'session', contractor: { id: user.contractor.id, name: user.contractor.name, company: user.contractor.company, plan: user.contractor.plan, subscriptionStatus: (user.contractor as any).subscriptionStatus, status: user.contractor.status } },
      'login', 'user', user.id, `Login: ${user.email}`, null, req,
    )

    return res
  } catch (err) {
    console.error('[auth/login] error:', err)
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 })
  }
}
