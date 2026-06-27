import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/security/password'
import { issueSession, setSessionCookie } from '@/lib/security/session'
import { checkBodySize } from '@/lib/security/body-size'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { getInvitePreview, hashInviteToken } from '@/lib/invitations/workspace-invites'

const AcceptSchema = z.object({
  token: z.string().min(20),
  name: z.string().min(2).max(160).optional(),
  password: z.string().min(8).max(200),
})

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ error: 'Invite token required' }, { status: 400 })
  const preview = await getInvitePreview(token)
  if (!preview) return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 404 })
  return NextResponse.json({ invite: preview })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const limited = rateLimitByIp(req, '/api/auth/invite/accept')
  if (limited) return limited

  const parsed = AcceptSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const tokenHash = hashInviteToken(parsed.data.token)
  const user = await db.user.findFirst({
    where: { passwordResetToken: tokenHash, passwordResetExpires: { gt: new Date() }, deletedAt: null },
    include: { contractor: true, workspaceMembers: { include: { workspace: { include: { chats: { select: { id: true, chatType: true } } } } } } },
  })
  if (!user) return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
  if (!user.contractor || user.contractor.status !== 'active' || user.contractor.deletedAt) {
    return NextResponse.json({ error: 'Company account is not active' }, { status: 403 })
  }

  const passwordHash = await hashPassword(parsed.data.password)
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      name: parsed.data.name?.trim() || user.name,
      passwordHash,
      status: 'active',
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      passwordResetToken: null,
      passwordResetExpires: null,
      tokenVersion: { increment: 1 },
      lastLoginAt: new Date(),
      lastLoginIp: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    },
  })

  await db.inboxItem.create({
    data: {
      contractorId: user.contractorId,
      userId: updated.id,
      role: updated.role,
      type: 'connection_onboarding',
      title: roleWelcomeTitle(updated.role),
      summary: roleWelcomeSummary(updated.role),
      priority: 'normal',
      payloadJson: JSON.stringify({ cardType: 'connection_onboarding', role: updated.role }),
    },
  }).catch(() => null)

  const token = await issueSession({
    sub: updated.id,
    cid: updated.contractorId,
    email: updated.email,
    role: updated.role,
    name: updated.name,
    tv: (updated.tokenVersion ?? 0),
  })

  const firstMember = user.workspaceMembers[0]
  const firstWorkspace = firstMember?.workspace
  const explicitChatIds = new Set(
    String(firstMember?.permissions ?? '')
      .split(',')
      .map(part => part.trim())
      .filter(part => part.startsWith('chat:'))
      .map(part => part.slice('chat:'.length)),
  )
  const firstChat = firstWorkspace?.chats.find(chat => explicitChatIds.has(chat.id))
    ?? firstWorkspace?.chats.find(chat => roleDefaultChatTypes(updated.role).includes(chat.chatType))
    ?? firstWorkspace?.chats[0]
    ?? null
  const res = NextResponse.json({
    success: true,
    user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role },
    contractor: { id: user.contractor.id, name: user.contractor.name, company: user.contractor.company },
    redirectTo: '/',
    workspaceId: firstWorkspace?.id ?? null,
    chatId: firstChat?.id ?? null,
  })
  setSessionCookie(res, token)
  return res
}

function roleDefaultChatTypes(role?: string | null) {
  const r = String(role ?? '').toLowerCase()
  if (r === 'customer') return ['customer']
  if (r === 'crew' || r === 'subcontractor') return ['crew', 'roofing_crew', 'gutter_crew', 'window_crew', 'siding_crew', 'field_crew', 'subcontractor']
  if (r === 'sales') return ['sales']
  return ['main']
}

function roleWelcomeTitle(role?: string | null) {
  const r = String(role ?? '').toLowerCase()
  if (r === 'customer') return 'Welcome to your homeowner chat'
  if (r === 'crew' || r === 'subcontractor') return 'Welcome to the crew chat'
  return 'Welcome to the team'
}

function roleWelcomeSummary(role?: string | null) {
  const r = String(role ?? '').toLowerCase()
  if (r === 'customer') return 'You can message the contractor team, see shared job updates, and respond inside your Jobrolo chat.'
  if (r === 'crew' || r === 'subcontractor') return 'Use the crew chat for job notes, install reminders, photos, questions, and field updates.'
  return 'Use Jobrolo chats to coordinate work, review action items, and keep job information connected.'
}
