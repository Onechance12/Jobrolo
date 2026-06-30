import { db } from '@/lib/db'

export type CommunicationChannel = 'email' | 'sms' | 'in_app_digest'
export type CommunicationStatus = 'queued' | 'skipped' | 'sent' | 'delivered' | 'failed' | 'cancelled'

export interface QueueCommunicationInput {
  contractorId: string
  userId?: string | null
  role?: string | null
  projectId?: string | null
  customerId?: string | null
  inboxItemId?: string | null
  actionRequestId?: string | null
  channel: CommunicationChannel | string
  type: string
  toAddress?: string | null
  subject?: string | null
  body: string
  htmlBody?: string | null
  priority?: string | null
  provider?: string | null
  dedupeKey?: string | null
  scheduledAt?: Date | string | null
  metadata?: Record<string, unknown> | null
}

function communicationEnabled() {
  return process.env.COMMUNICATIONS_ENABLED === 'true' || process.env.NODE_ENV !== 'production'
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

function now() { return new Date() }

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function providerFor(channel: string) {
  if (channel === 'sms') return process.env.SMS_PROVIDER || 'console'
  if (channel === 'email') return process.env.EMAIL_PROVIDER || process.env.RESET_EMAIL_PROVIDER || 'console'
  return 'system'
}

export async function queueCommunication(input: QueueCommunicationInput) {
  const provider = input.provider ?? providerFor(input.channel)
  const dedupeKey = input.dedupeKey ?? null
  if (dedupeKey) {
    const existing = await db.communicationMessage.findFirst({
      where: {
        contractorId: input.contractorId,
        channel: String(input.channel),
        dedupeKey,
        status: { in: ['queued', 'sent', 'delivered', 'skipped'] },
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }).catch(() => null)
    if (existing) return existing
  }

  const status: CommunicationStatus = communicationEnabled() ? 'queued' : 'skipped'
  return await db.communicationMessage.create({
    data: {
      contractorId: input.contractorId,
      userId: input.userId ?? undefined,
      role: input.role ?? undefined,
      projectId: input.projectId ?? undefined,
      customerId: input.customerId ?? undefined,
      inboxItemId: input.inboxItemId ?? undefined,
      actionRequestId: input.actionRequestId ?? undefined,
      channel: String(input.channel),
      type: input.type,
      toAddress: input.toAddress ?? undefined,
      subject: input.subject ?? undefined,
      body: input.body,
      htmlBody: input.htmlBody ?? undefined,
      status,
      priority: input.priority ?? 'normal',
      provider,
      dedupeKey: dedupeKey ?? undefined,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  })
}

async function sendEmailViaProvider(message: any) {
  const provider = String(message.provider || providerFor('email')).toLowerCase()
  const to = message.toAddress
  if (!to) throw new Error('Missing email recipient')
  const subject = message.subject || 'Jobrolo notification'
  const text = message.body
  const html = message.htmlBody || `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;color:#0f172a;white-space:pre-wrap">${escapeHtml(text)}</div>`
  const from = process.env.EMAIL_FROM || 'Jobrolo <notifications@jobrolo.local>'

  if (provider === 'console' || provider === 'log' || provider === 'dev') {
    console.log(`[communications][email:${provider}] to=${to} subject=${subject}\n${text}`)
    return { providerMessageId: `console-${Date.now()}` }
  }

  if (provider === 'resend') {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured')
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Resend failed: ${JSON.stringify(data)}`)
    return { providerMessageId: data.id }
  }

  if (provider === 'sendgrid') {
    const apiKey = process.env.SENDGRID_API_KEY
    if (!apiKey) throw new Error('SENDGRID_API_KEY is not configured')
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: parseEmailFrom(from),
        subject,
        content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
      }),
    })
    if (!res.ok) throw new Error(`SendGrid failed: ${res.status} ${await res.text().catch(() => '')}`)
    return { providerMessageId: res.headers.get('x-message-id') || `sendgrid-${Date.now()}` }
  }

  if (provider === 'postmark') {
    const token = process.env.POSTMARK_SERVER_TOKEN
    if (!token) throw new Error('POSTMARK_SERVER_TOKEN is not configured')
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'X-Postmark-Server-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ From: extractEmailAddress(from), To: to, Subject: subject, TextBody: text, HtmlBody: html }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Postmark failed: ${JSON.stringify(data)}`)
    return { providerMessageId: data.MessageID }
  }

  throw new Error(`Unsupported email provider: ${provider}`)
}

async function sendSmsViaProvider(message: any) {
  const provider = String(message.provider || providerFor('sms')).toLowerCase()
  const to = message.toAddress
  if (!to) throw new Error('Missing SMS recipient')
  const body = message.body

  if (provider === 'console' || provider === 'log' || provider === 'dev') {
    console.log(`[communications][sms:${provider}] to=${to}\n${body}`)
    return { providerMessageId: `console-sms-${Date.now()}` }
  }

  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const from = await resolveTwilioFromNumber(message)
    if (!sid || !token || !from) throw new Error('Twilio credentials are not configured')
    const auth = Buffer.from(`${sid}:${token}`).toString('base64')
    const params = new URLSearchParams({ From: from, To: to, Body: body })
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Twilio failed: ${JSON.stringify(data)}`)
    return { providerMessageId: data.sid }
  }

  throw new Error(`Unsupported SMS provider: ${provider}`)
}

async function resolveTwilioFromNumber(message: any) {
  const contractorId = message.contractorId ? String(message.contractorId) : ''
  if (contractorId) {
    const companyNumber = await db.companyPhoneNumber.findFirst({
      where: { contractorId, provider: 'twilio', status: 'active' },
      orderBy: [{ purpose: 'asc' }, { createdAt: 'asc' }],
    }).catch(() => null)
    if (companyNumber?.phoneNumber) return companyNumber.phoneNumber
  }
  return process.env.TWILIO_FROM_NUMBER
}

export async function dispatchCommunicationMessage(id: string) {
  const message = await db.communicationMessage.findUnique({ where: { id } })
  if (!message) return null
  if (!['queued', 'failed'].includes(message.status)) return message
  if (message.scheduledAt && message.scheduledAt > now()) return message
  if (!communicationEnabled()) {
    return await db.communicationMessage.update({ where: { id }, data: { status: 'skipped', error: 'COMMUNICATIONS_ENABLED is not true in production', failedAt: now() } })
  }

  try {
    let sent: { providerMessageId?: string | null }
    if (message.channel === 'email') sent = await sendEmailViaProvider(message)
    else if (message.channel === 'sms') sent = await sendSmsViaProvider(message)
    else sent = { providerMessageId: `system-${Date.now()}` }
    return await db.communicationMessage.update({
      where: { id },
      data: { status: 'sent', providerMessageId: sent.providerMessageId ?? undefined, sentAt: now(), error: null },
    })
  } catch (err) {
    return await db.communicationMessage.update({
      where: { id },
      data: { status: 'failed', error: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000), failedAt: now() },
    })
  }
}

export async function dispatchQueuedCommunications(limit = 50) {
  const messages = await db.communicationMessage.findMany({
    where: { status: 'queued', OR: [{ scheduledAt: null }, { scheduledAt: { lte: now() } }] },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: Math.min(Math.max(limit, 1), 200),
  })
  let sent = 0
  let failed = 0
  for (const message of messages) {
    const updated = await dispatchCommunicationMessage(message.id)
    if (updated?.status === 'sent') sent++
    if (updated?.status === 'failed') failed++
  }
  return { processed: messages.length, sent, failed }
}

export function signingUrl(token: string) { return `${appUrl()}/sign/${token}` }
export function storageUrl(path: string) { return path.startsWith('http') ? path : `${appUrl()}${path.startsWith('/') ? path : `/${path}`}` }

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}
function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/)
  return match?.[1] ?? value
}
function parseEmailFrom(value: string) {
  const email = extractEmailAddress(value)
  const name = value.includes('<') ? value.split('<')[0].trim().replace(/^"|"$/g, '') : undefined
  return name ? { email, name } : { email }
}
