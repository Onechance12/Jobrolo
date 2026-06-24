import { checkBodySize } from '@/lib/security/body-size'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generatePasswordResetToken } from '@/lib/security/password'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { createHash } from 'node:crypto'
import { queueCommunication, dispatchCommunicationMessage } from '@/lib/communications'
export const runtime = 'nodejs'

// Hash reset tokens before storing — never store raw tokens
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// POST /api/auth/reset-password/request
// Body: { email }
// Always returns 200 (don't leak whether email exists)
export async function POST(req: NextRequest) {
  try {
    const sizeError = checkBodySize(req)
    if (sizeError) return sizeError
    // Rate limit: 3 requests per 3 minutes per IP
    const limited = rateLimitByIp(req, '/api/auth/reset-password/request')
    if (limited) return limited

    const { email } = await req.json() as { email?: string }
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
    if (user) {
      const rawToken = generatePasswordResetToken()
      const hashedToken = hashToken(rawToken) // Store HASH, not raw token
      const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      await db.user.update({
        where: { id: user.id },
        data: { passwordResetToken: hashedToken, passwordResetExpires: expires },
      })

      const resetUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/reset-password?token=${rawToken}`
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[auth][dev] Password reset token for ${user.email}: ${rawToken}`)
        console.log(`[auth][dev] Reset link: ${resetUrl}`)
      }
      try {
        const message = await queueCommunication({
          contractorId: user.contractorId,
          userId: user.id,
          channel: 'email',
          type: 'password_reset',
          toAddress: user.email,
          subject: 'Reset your Jobrolo password',
          body: `Use this secure link to reset your Jobrolo password. The link expires in 1 hour.

${resetUrl}`,
          htmlBody: `<p>Use this secure link to reset your Jobrolo password. The link expires in 1 hour.</p><p><a href="${resetUrl}">Reset password</a></p>`,
          priority: 'high',
          dedupeKey: `password_reset:${user.id}:${hashedToken}`,
        })
        if (process.env.COMMUNICATIONS_ENABLED === 'true') await dispatchCommunicationMessage(message.id).catch(() => null)
      } catch (err) {
        console.error('[auth] password reset email queue failed:', err)
      }
    }
    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true, message: 'If that email exists, a reset link has been sent.' })
  } catch (err) {
    console.error('[auth/reset-password/request] error:', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
