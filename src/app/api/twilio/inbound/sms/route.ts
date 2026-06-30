import { db } from '@/lib/db'
import { createRoleNotification } from '@/lib/notifications'
import { normalizePhoneE164 } from '@/lib/phone'
import { validateTwilioWebhook } from '@/lib/twilio-webhook'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const params = new URLSearchParams(rawBody)
    if (!validateTwilioWebhook(req, params)) {
      return new NextResponse('Invalid Twilio signature', { status: 403 })
    }

    const to = normalizePhoneE164(params.get('To'))
    const from = normalizePhoneE164(params.get('From'))
    const body = String(params.get('Body') || '').trim()
    const messageSid = String(params.get('MessageSid') || params.get('SmsSid') || '')
    if (!to.ok) return twiml()

    const companyNumber = await db.companyPhoneNumber.findFirst({
      where: { phoneNumber: to.e164, provider: 'twilio', status: 'active' },
    })
    if (!companyNumber) return twiml()

    const message = await db.communicationMessage.create({
      data: {
        contractorId: companyNumber.contractorId,
        channel: 'sms',
        type: 'incoming_sms',
        toAddress: to.e164,
        body,
        status: 'delivered',
        provider: 'twilio',
        providerMessageId: messageSid || undefined,
        deliveredAt: new Date(),
        metadataJson: JSON.stringify({
          from: from.ok ? from.e164 : params.get('From'),
          to: to.e164,
          companyPhoneNumberId: companyNumber.id,
          raw: Object.fromEntries(params.entries()),
        }),
      },
    })

    await createRoleNotification({
      contractorId: companyNumber.contractorId,
      role: 'owner',
      type: 'incoming_sms',
      title: `Incoming text from ${from.ok ? from.national : params.get('From') || 'unknown'}`,
      summary: body.slice(0, 220) || 'Incoming SMS received.',
      priority: 'normal',
      relatedType: 'communication_message',
      relatedId: message.id,
      payload: { communicationMessageId: message.id, companyPhoneNumberId: companyNumber.id },
    }).catch(err => console.error('[twilio/inbound/sms] notification failed:', err))

    return twiml()
  } catch (err) {
    console.error('[twilio/inbound/sms] error:', err)
    return twiml()
  }
}

function twiml() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
