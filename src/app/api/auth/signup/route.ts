import { checkBodySize } from '@/lib/security/body-size'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bootstrapTenant } from '@/lib/security/bootstrap'
import { issueSession, setSessionCookie } from '@/lib/security/session'
import { audit } from '@/lib/security/context'
import { rateLimitByIp } from '@/lib/security/rate-limit'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const sizeError = checkBodySize(req)
    if (sizeError) return sizeError
    // Rate limit: 3 signups per 6 minutes per IP
    const limited = rateLimitByIp(req, '/api/auth/signup')
    if (limited) return limited

    const body = await req.json()
    const { name, email, password, companyName, website } = body as {
      name?: string; email?: string; password?: string; companyName?: string; website?: string
    }

    // Validation
    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 })
    }
    if (name.trim().length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // Check for existing user with this email
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    // Bootstrap the tenant (contractor + user + workspace + channels)
    const { userId, contractorId } = await bootstrapTenant({
      name: name.trim(),
      email: email.toLowerCase(),
      password,
      companyName: companyName?.trim() || undefined,
      website: website?.trim() || undefined,
    })

    // Issue session
    const user = await db.user.findUnique({ where: { id: userId }, include: { contractor: true } })
    if (!user) throw new Error('User creation failed')

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
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      contractor: { id: user.contractor.id, name: user.contractor.name, company: user.contractor.company },
      redirectTo: '/onboarding',
    })
    setSessionCookie(res, token)

    await audit(
      { contractorId, user: { id: userId, contractorId, name: user.name, email: user.email, role: user.role, status: 'active' }, actor: `user:${user.email}`, authMethod: 'session', contractor: { id: user.contractor.id, name: user.contractor.name, company: user.contractor.company, plan: user.contractor.plan, subscriptionStatus: (user.contractor as any).subscriptionStatus, status: user.contractor.status } },
      'signup', 'user', userId, `New account: ${user.email}`, null, req,
    )

    return res
  } catch (err) {
    console.error('[auth/signup] error:', err)
    return NextResponse.json({ error: 'Signup failed. Please try again.' }, { status: 500 })
  }
}
