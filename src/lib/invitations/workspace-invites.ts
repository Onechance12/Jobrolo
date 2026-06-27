import { randomBytes, createHash } from 'node:crypto'
import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/security/context'
import { queueCommunication, dispatchCommunicationMessage } from '@/lib/communications'
import { createRoleNotification } from '@/lib/notifications'

const INVITE_TTL_DAYS = 7

export type InviteRole = 'employee' | 'manager' | 'sales' | 'crew' | 'subcontractor' | 'customer'

export type CreateWorkspaceInviteInput = {
  workspaceId: string
  chatId?: string | null
  name: string
  email: string
  phone?: string | null
  role: InviteRole | string
  sendEmail?: boolean
  sendSms?: boolean
  note?: string | null
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

function workspaceChatUrl(workspaceId: string, chatId?: string | null) {
  const params = new URLSearchParams({ workspaceId })
  if (chatId) params.set('chatId', chatId)
  return `${appUrl()}/?${params.toString()}`
}

export function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase()
}

function normalizeRole(role: string): InviteRole {
  const lower = role.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (['customer', 'homeowner', 'client'].includes(lower)) return 'customer'
  if (['crew', 'installer', 'field', 'roofer'].includes(lower)) return 'crew'
  if (['sub', 'subcontractor', 'sub_contractor', 'trade'].includes(lower)) return 'subcontractor'
  if (['sales', 'sales_rep'].includes(lower)) return 'sales'
  if (['manager', 'project_manager', 'admin'].includes(lower)) return 'manager'
  return 'employee'
}

function permissionsFor(role: InviteRole, chatId?: string | null, existing?: string | null) {
  const parts = new Set(
    (existing || '')
      .split(',')
      .map(part => part.trim())
      .filter(Boolean),
  )
  const base =
    role === 'customer' ? 'read,write_limited,customer' :
    role === 'crew' || role === 'subcontractor' ? 'read,write_limited,field' :
    role === 'sales' ? 'read,write,sales' :
    'read,write'
  for (const part of base.split(',')) parts.add(part)
  if ((role === 'customer' || role === 'crew' || role === 'subcontractor') && chatId) {
    parts.add(`chat:${chatId}`)
  }
  return Array.from(parts).join(',')
}

function canInvite(role?: string | null) {
  return ['owner', 'admin', 'manager', 'project_manager'].includes(String(role ?? '').toLowerCase())
}

function inviteCopy(role: InviteRole, workspaceName: string, chatTitle?: string | null) {
  const chatPart = chatTitle ? ` (${chatTitle})` : ''
  if (role === 'customer') {
    return {
      subject: `You're invited to your Jobrolo homeowner chat`,
      body: `You've been invited to ${workspaceName}${chatPart} in Jobrolo so you can follow updates and message the team.`,
    }
  }
  if (role === 'crew' || role === 'subcontractor') {
    return {
      subject: `You're invited to a Jobrolo crew chat`,
      body: `You've been invited to ${workspaceName}${chatPart} in Jobrolo for job notes, crew coordination, photos, and updates.`,
    }
  }
  return {
    subject: `You're invited to Jobrolo`,
    body: `You've been invited to ${workspaceName}${chatPart} in Jobrolo to help manage work with the team.`,
  }
}

export async function createWorkspaceInvite(ctx: TenantContext, input: CreateWorkspaceInviteInput) {
  if (!ctx.user || !canInvite(ctx.user.role)) throw new Error('Only an owner, admin, manager, or project manager can invite people')
  const email = normalizedEmail(input.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email is required for account invites')
  const name = input.name.trim()
  if (name.length < 2) throw new Error('Invitee name is required')

  const workspace = await db.workspace.findFirst({
    where: { id: input.workspaceId, contractorId: ctx.contractorId, status: 'active' },
    include: {
      project: { select: { id: true, title: true, customerId: true } },
      customer: { select: { id: true, name: true } },
      chats: { select: { id: true, title: true, chatType: true, visibility: true } },
    },
  })
  if (!workspace) throw new Error('Workspace not found')

  const selectedChat = input.chatId
    ? workspace.chats.find(chat => chat.id === input.chatId)
    : workspace.chats[0] ?? null
  if (input.chatId && !selectedChat) throw new Error('Chat not found in this workspace')

  const role = normalizeRole(input.role)
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashInviteToken(token)
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const existingUser = await db.user.findUnique({ where: { email }, include: { contractor: true } })
  if (existingUser && existingUser.contractorId !== ctx.contractorId) {
    throw new Error('That email is already attached to another Jobrolo company')
  }

  const user = existingUser
    ? await db.user.update({
        where: { id: existingUser.id },
        data: {
          name,
          phone: input.phone?.trim() || existingUser.phone,
          role,
          status: existingUser.status === 'active' ? 'active' : 'invited',
          passwordResetToken: tokenHash,
          passwordResetExpires: expires,
        },
      })
    : await db.user.create({
        data: {
          contractorId: ctx.contractorId,
          name,
          email,
          phone: input.phone?.trim() || undefined,
          role,
          status: 'invited',
          passwordResetToken: tokenHash,
          passwordResetExpires: expires,
        },
      })

  const existingMember = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    select: { permissions: true },
  })
  const permissions = permissionsFor(role, selectedChat?.id ?? null, existingMember?.permissions)
  const member = await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role, permissions },
    create: { workspaceId: workspace.id, userId: user.id, role, permissions },
  })

  const inviteUrl = `${appUrl()}/invite?token=${encodeURIComponent(token)}`
  const chatUrl = workspaceChatUrl(workspace.id, selectedChat?.id ?? null)
  const copy = inviteCopy(role, workspace.name, selectedChat?.title)
  const body = `${copy.body}

Open your invite: ${inviteUrl}

This invite expires in ${INVITE_TTL_DAYS} days.${input.note ? `\n\nNote from ${ctx.user.name}: ${input.note.trim()}` : ''}`

  const notification = await createRoleNotification({
    contractorId: ctx.contractorId,
    userId: user.id,
    role,
    projectId: workspace.projectId,
    customerId: workspace.customerId ?? workspace.project?.customerId ?? undefined,
    type: 'chat_invite',
    title: `Chat invite: ${workspace.name}`,
    summary: `${ctx.user.name} invited ${name} to ${workspace.name}${selectedChat ? ` / ${selectedChat.title}` : ''}.`,
    priority: 'normal',
    relatedType: 'workspace',
    relatedId: workspace.id,
    payload: {
      workspaceId: workspace.id,
      chatId: selectedChat?.id ?? null,
      inviteeUserId: user.id,
      inviteeRole: role,
      inviteUrl,
      chatUrl,
      cardType: 'chat_invite',
    },
  })

  const deliveries: any[] = []
  if (input.sendEmail === true) {
    const msg = await queueCommunication({
      contractorId: ctx.contractorId,
      userId: user.id,
      role,
      projectId: workspace.projectId,
      customerId: workspace.customerId ?? workspace.project?.customerId ?? undefined,
      inboxItemId: notification.id,
      channel: 'email',
      type: 'chat_invite',
      toAddress: user.email,
      subject: copy.subject,
      body,
      htmlBody: `<p>${escapeHtml(copy.body)}</p><p><a href="${inviteUrl}">Accept Jobrolo invite</a></p><p>This invite expires in ${INVITE_TTL_DAYS} days.</p>`,
      priority: 'normal',
      dedupeKey: `chat_invite:email:${workspace.id}:${user.id}:${tokenHash.slice(0, 12)}`,
      metadata: { workspaceId: workspace.id, chatId: selectedChat?.id ?? null, inviteRole: role },
    })
    deliveries.push(await dispatchCommunicationMessage(msg.id).catch(() => msg))
  }
  if (input.sendSms && user.phone) {
    const msg = await queueCommunication({
      contractorId: ctx.contractorId,
      userId: user.id,
      role,
      projectId: workspace.projectId,
      customerId: workspace.customerId ?? workspace.project?.customerId ?? undefined,
      inboxItemId: notification.id,
      channel: 'sms',
      type: 'chat_invite',
      toAddress: user.phone,
      body: `${copy.body} ${inviteUrl}`,
      priority: 'normal',
      dedupeKey: `chat_invite:sms:${workspace.id}:${user.id}:${tokenHash.slice(0, 12)}`,
      metadata: { workspaceId: workspace.id, chatId: selectedChat?.id ?? null, inviteRole: role },
    })
    deliveries.push(await dispatchCommunicationMessage(msg.id).catch(() => msg))
  }

  return {
    inviteUrl,
    chatUrl,
    expiresAt: expires,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, status: user.status },
    workspace: { id: workspace.id, name: workspace.name, type: workspace.type, projectId: workspace.projectId, customerId: workspace.customerId },
    chat: selectedChat,
    member,
    notification,
    deliveries: deliveries.map((d: any) => ({ id: d?.id, channel: d?.channel, status: d?.status, provider: d?.provider, error: d?.error })),
    message: `Created invite for ${user.name} (${role}) to ${workspace.name}${selectedChat ? ` / ${selectedChat.title}` : ''}.`,
  }
}

export async function getInvitePreview(token: string) {
  const hashed = hashInviteToken(token)
  const user = await db.user.findFirst({
    where: { passwordResetToken: hashed, passwordResetExpires: { gt: new Date() }, deletedAt: null },
    include: {
      contractor: { select: { id: true, company: true, name: true } },
      workspaceMembers: {
        take: 5,
        include: { workspace: { select: { id: true, name: true, type: true, project: { select: { id: true, title: true } }, chats: { select: { id: true, title: true, chatType: true, visibility: true } } } } },
      },
    },
  })
  if (!user) return null
  return {
    user: { name: user.name, email: user.email, role: user.role, status: user.status },
    contractor: user.contractor,
    workspaces: user.workspaceMembers.map(member => ({ role: member.role, permissions: member.permissions, workspace: member.workspace })),
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}
