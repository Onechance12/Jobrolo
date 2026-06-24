import { checkBodySize } from '@/lib/security/body-size'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/security/password'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { createHash } from 'node:crypto'
export const runtime = 'nodejs'

// Hash the submitted token before comparing with stored hash
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// POST /api/auth/reset-password/confirm
// Body: { token, newPassword }
export async function POST(req: NextRequest) {
  try {
    const sizeError = checkBodySize(req)
    if (sizeError) return sizeError
    // Rate limit: 5 attempts per 3 minutes per IP
    const limited = rateLimitByIp(req, '/api/auth/reset-password/confirm')
    if (limited) return limited

    const { token, newPassword } = await req.json() as { token?: string; newPassword?: string }
    if (!token || !newPassword) {
      return NextResponse.json({ error: 'Token and new password are required' }, { status: 400 })
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // SECURITY: Hash the submitted token and compare with stored hash
    const hashedToken = hashToken(token)
    const user = await db.user.findFirst({
      where: { passwordResetToken: hashedToken, passwordResetExpires: { gt: new Date() } },
      include: { contractor: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 })
    }

    const passwordHash = await hashPassword(newPassword)
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,      // Clear token — prevent reuse
        passwordResetExpires: null,
        // SECURITY: Increment tokenVersion to invalidate ALL existing sessions
        tokenVersion: { increment: 1 },
      },
    })

    // SECURITY: Do NOT auto-login after password reset — require explicit login.
    // This prevents session fixation attacks.
    return NextResponse.json({
      success: true,
      message: 'Password reset successfully. Please log in with your new password.',
      redirectTo: '/login',
    })
  } catch (err) {
    console.error('[auth/reset-password/confirm] error:', err)
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 })
  }
}
