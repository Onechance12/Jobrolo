import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/security/context'
import { queueCommunication, dispatchCommunicationMessage, signingUrl } from '@/lib/communications'

export type NotificationPreferencePatch = {
  role?: string | null
  userId?: string | null
  inAppEnabled?: boolean
  emailEnabled?: boolean
  smsEnabled?: boolean
  urgentOnly?: boolean
  dailyDigest?: boolean
  mutedTypes?: string[]
  quietHours?: Record<string, unknown> | null
}

const HIGH_PRIORITY = new Set(['high', 'urgent'])
const DEFAULT_ROLE_EMAIL = process.env.NOTIFICATIONS_EMAIL_DEFAULT === 'true'
const DEFAULT_ROLE_SMS = process.env.NOTIFICATIONS_SMS_DEFAULT === 'true'
const SEND_IMMEDIATELY = process.env.NOTIFICATIONS_SEND_IMMEDIATELY === 'true'

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function isMuted(pref: any, type: string) {
  const muted = safeJson<string[]>(pref?.mutedTypesJson, [])
  return muted.includes(type)
}

function shouldDeliver(pref: any, channel: 'email' | 'sms', item: any) {
  if (isMuted(pref, item.type)) return false
  if (pref?.urgentOnly && !HIGH_PRIORITY.has(String(item.priority))) return false
  if (pref?.dailyDigest) return false
  if (channel === 'email') return pref?.emailEnabled ?? DEFAULT_ROLE_EMAIL
  if (channel === 'sms') return pref?.smsEnabled ?? DEFAULT_ROLE_SMS
  return true
}

async function getPreferenceForItem(item: any, user?: any | null) {
  const userPref = user?.id ? await db.notificationPreference.findFirst({ where: { contractorId: item.contractorId, userId: user.id }, orderBy: { updatedAt: 'desc' } }).catch(() => null) : null
  if (userPref) return userPref
  const rolePref = await db.notificationPreference.findFirst({ where: { contractorId: item.contractorId, role: item.role }, orderBy: { updatedAt: 'desc' } }).catch(() => null)
  if (rolePref) return rolePref
  return { inAppEnabled: true, emailEnabled: DEFAULT_ROLE_EMAIL, smsEnabled: DEFAULT_ROLE_SMS, urgentOnly: false, dailyDigest: false, mutedTypesJson: null }
}

export async function getNotificationPreferences(ctx: TenantContext) {
  const prefs = await db.notificationPreference.findMany({
    where: { contractorId: ctx.contractorId, OR: [{ userId: ctx.user?.id ?? '__none__' }, { role: ctx.user?.role ?? '__none__' }, { userId: null, role: null }] },
    orderBy: { updatedAt: 'desc' },
  })
  return { preferences: prefs }
}

export async function upsertNotificationPreference(ctx: TenantContext, patch: NotificationPreferencePatch) {
  const userId = patch.userId === undefined ? ctx.user?.id : patch.userId
  const role = patch.role === undefined ? null : patch.role
  const where = { contractorId: ctx.contractorId, ...(userId ? { userId } : { userId: null }), ...(role ? { role } : { role: null }) }
  const existing = await db.notificationPreference.findFirst({ where })
  const data = {
    contractorId: ctx.contractorId,
    userId: userId ?? undefined,
    role: role ?? undefined,
    inAppEnabled: patch.inAppEnabled ?? undefined,
    emailEnabled: patch.emailEnabled ?? undefined,
    smsEnabled: patch.smsEnabled ?? undefined,
    urgentOnly: patch.urgentOnly ?? undefined,
    dailyDigest: patch.dailyDigest ?? undefined,
    mutedTypesJson: patch.mutedTypes ? JSON.stringify(patch.mutedTypes) : undefined,
    quietHoursJson: patch.quietHours ? JSON.stringify(patch.quietHours) : undefined,
  }
  if (existing) return await db.notificationPreference.update({ where: { id: existing.id }, data })
  return await db.notificationPreference.create({ data })
}

export async function listNotifications(ctx: TenantContext, opts: { status?: string | null; projectId?: string | null; role?: string | null; limit?: number } = {}) {
  const role = opts.role ?? ctx.user?.role ?? undefined
  const items = await db.inboxItem.findMany({
    where: {
      contractorId: ctx.contractorId,
      ...(role ? { OR: [{ role }, { userId: ctx.user?.id ?? '__none__' }] } : {}),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.status ? { status: opts.status } : { status: { in: ['unread', 'read'] } }),
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(Math.max(opts.limit ?? 100, 1), 250),
  })
  const ids = items.map(i => i.id)
  const deliveries = ids.length ? await db.communicationMessage.findMany({
    where: { contractorId: ctx.contractorId, inboxItemId: { in: ids } },
    orderBy: { createdAt: 'desc' },
  }) : []
  return { count: items.length, items, deliveries }
}

export async function markNotification(ctx: TenantContext, id: string, status: 'read' | 'unread' | 'actioned' | 'archived') {
  const item = await db.inboxItem.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!item) return null
  const now = new Date()
  return await db.inboxItem.update({
    where: { id },
    data: {
      status,
      readAt: status === 'read' ? now : item.readAt,
      actionedAt: status === 'actioned' || status === 'archived' ? now : item.actionedAt,
    },
  })
}

export async function handleInboxItemCreated(inboxItemId: string) {
  const item = await db.inboxItem.findUnique({ where: { id: inboxItemId } })
  if (!item) return null
  const users = item.userId
    ? await db.user.findMany({ where: { id: item.userId, contractorId: item.contractorId, status: 'active' } })
    : await db.user.findMany({ where: { contractorId: item.contractorId, status: 'active', role: { in: roleAliases(item.role) } }, take: 25 })

  const targets = users.length ? users : [null]
  const queued: any[] = []
  for (const user of targets) {
    const pref = await getPreferenceForItem(item, user)
    if (!pref?.inAppEnabled && !shouldDeliver(pref, 'email', item) && !shouldDeliver(pref, 'sms', item)) continue

    if (user?.email && shouldDeliver(pref, 'email', item)) {
      const msg = await queueCommunication({
        contractorId: item.contractorId,
        userId: user.id,
        role: item.role,
        projectId: item.projectId,
        customerId: item.customerId,
        inboxItemId: item.id,
        actionRequestId: item.actionRequestId,
        channel: 'email',
        type: item.type,
        toAddress: user.email,
        subject: `[Jobrolo] ${item.title}`,
        body: buildNotificationText(item),
        htmlBody: buildNotificationHtml(item),
        priority: item.priority,
        dedupeKey: `email:inbox:${item.id}:${user.id}`,
        metadata: { source: 'inbox_item' },
      })
      queued.push(msg)
      if (SEND_IMMEDIATELY || item.priority === 'urgent') await dispatchCommunicationMessage(msg.id).catch(() => null)
    }

    if (user?.phone && shouldDeliver(pref, 'sms', item)) {
      const msg = await queueCommunication({
        contractorId: item.contractorId,
        userId: user.id,
        role: item.role,
        projectId: item.projectId,
        customerId: item.customerId,
        inboxItemId: item.id,
        actionRequestId: item.actionRequestId,
        channel: 'sms',
        type: item.type,
        toAddress: user.phone,
        body: buildSmsText(item),
        priority: item.priority,
        dedupeKey: `sms:inbox:${item.id}:${user.id}`,
        metadata: { source: 'inbox_item' },
      })
      queued.push(msg)
      if (SEND_IMMEDIATELY || item.priority === 'urgent') await dispatchCommunicationMessage(msg.id).catch(() => null)
    }
  }
  return { item, queued }
}

export async function createRoleNotification(input: {
  contractorId: string
  role: string
  userId?: string | null
  projectId?: string | null
  customerId?: string | null
  type: string
  title: string
  summary?: string | null
  priority?: string | null
  actionRequestId?: string | null
  relatedType?: string | null
  relatedId?: string | null
  payload?: unknown
}) {
  const item = await db.inboxItem.create({
    data: {
      contractorId: input.contractorId,
      role: input.role,
      userId: input.userId ?? undefined,
      projectId: input.projectId ?? undefined,
      customerId: input.customerId ?? undefined,
      type: input.type,
      title: input.title,
      summary: input.summary ?? undefined,
      priority: input.priority ?? 'normal',
      actionRequestId: input.actionRequestId ?? undefined,
      relatedType: input.relatedType ?? undefined,
      relatedId: input.relatedId ?? undefined,
      payloadJson: input.payload ? JSON.stringify(input.payload) : undefined,
    },
  })
  await handleInboxItemCreated(item.id).catch(err => console.error('[notifications] delivery queue failed:', err))
  return item
}

export async function queueSignatureRequestDelivery(input: { contractorId: string; signatureRequestId: string }) {
  const sig = await db.signatureRequest.findFirst({ where: { id: input.signatureRequestId, contractorId: input.contractorId }, include: { generatedDocument: true } })
  if (!sig || !sig.signerEmail) return null
  const body = `Please review and sign: ${sig.title}\n\nSigning link: ${signingUrl(sig.signatureToken)}\n\nThis link should only be used by ${sig.signerName}.`
  const msg = await queueCommunication({
    contractorId: input.contractorId,
    projectId: sig.projectId,
    customerId: sig.customerId,
    channel: 'email',
    type: 'signature_link',
    toAddress: sig.signerEmail,
    subject: `Signature requested: ${sig.title}`,
    body,
    htmlBody: `<p>Please review and sign: <strong>${escapeHtml(sig.title)}</strong></p><p><a href="${signingUrl(sig.signatureToken)}">Open secure signing link</a></p><p>This link should only be used by ${escapeHtml(sig.signerName)}.</p>`,
    priority: 'high',
    dedupeKey: `signature_link:${sig.id}:${sig.signerEmail}`,
    metadata: { signatureRequestId: sig.id, generatedDocumentId: sig.generatedDocumentId },
  })
  if (SEND_IMMEDIATELY) await dispatchCommunicationMessage(msg.id).catch(() => null)
  return msg
}

export async function queueSignedDocumentCopy(input: { contractorId: string; signatureRequestId: string; signedPdfUrl?: string | null }) {
  const sig = await db.signatureRequest.findFirst({ where: { id: input.signatureRequestId, contractorId: input.contractorId } })
  if (!sig?.signerEmail) return null
  // Do not email private /api/storage URLs to external signers. That route is
  // authenticated and intentionally internal. A public tokenized signed-copy
  // link can be added later without changing the saved PDF workflow.
  const body = `Thank you. ${sig.title} has been signed and saved. The office has the final copy in the job packet.`
  const msg = await queueCommunication({
    contractorId: input.contractorId,
    projectId: sig.projectId,
    customerId: sig.customerId,
    channel: 'email',
    type: 'signed_pdf_copy',
    toAddress: sig.signerEmail,
    subject: `Signed copy: ${sig.title}`,
    body,
    htmlBody: `<p>Thank you. <strong>${escapeHtml(sig.title)}</strong> has been signed and saved.</p><p>The office has the final copy in the job packet.</p>`,
    priority: 'normal',
    dedupeKey: `signed_copy:${sig.id}:${sig.signerEmail}`,
    metadata: { signatureRequestId: sig.id, signedPdfUrl: input.signedPdfUrl },
  })
  if (SEND_IMMEDIATELY) await dispatchCommunicationMessage(msg.id).catch(() => null)
  return msg
}

function roleAliases(role: string) {
  const r = String(role || '').toLowerCase()
  if (r === 'project_manager') return ['project_manager', 'manager', 'admin', 'owner']
  if (r === 'coordinator') return ['coordinator', 'manager', 'admin', 'owner']
  if (r === 'supplier') return ['supplier', 'purchasing', 'manager', 'admin', 'owner']
  if (r === 'finance') return ['finance', 'accounting', 'admin', 'owner']
  if (r === 'crew') return ['crew']
  if (r === 'owner') return ['owner', 'admin']
  return [r]
}

function buildNotificationText(item: any) {
  return [item.title, item.summary, item.projectId ? `Project ID: ${item.projectId}` : null, 'Open Jobrolo to review and take action.'].filter(Boolean).join('\n\n')
}
function buildSmsText(item: any) {
  const summary = item.summary ? ` — ${String(item.summary).slice(0, 80)}` : ''
  return `Jobrolo: ${item.title}${summary}`.slice(0, 320)
}
function buildNotificationHtml(item: any) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;color:#0f172a"><h2>${escapeHtml(item.title)}</h2>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}<p>Open Jobrolo to review and take action.</p></div>`
}
function escapeHtml(value: string) {
  return String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}
