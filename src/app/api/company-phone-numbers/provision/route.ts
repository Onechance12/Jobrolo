import { db } from '@/lib/db'
import { buyTwilioPhoneNumber, twilioPhoneProvisioningConfigured } from '@/lib/twilio'
import { audit, ForbiddenError, requireContext, UnauthorizedError } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { normalizePhoneE164 } from '@/lib/phone'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type Body = {
  phoneNumber?: string
  purpose?: string
  friendlyName?: string
  confirm?: boolean
}

export async function POST(req: NextRequest) {
  try {
    const sizeError = checkBodySize(req)
    if (sizeError) return sizeError
    const ctx = await requireContext(req)
    if (!ctx.user || !['owner', 'admin'].includes(ctx.user.role)) {
      throw new ForbiddenError('Only owner/admin users can provision company phone numbers')
    }
    const limited = rateLimitByIp(req, '/api/company-phone-numbers/provision')
    if (limited) return limited
    if (!twilioPhoneProvisioningConfigured()) {
      return NextResponse.json({ error: 'Twilio phone provisioning is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.' }, { status: 503 })
    }

    const body = await req.json() as Body
    const normalized = normalizePhoneE164(body.phoneNumber)
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })
    if (body.confirm !== true) {
      return NextResponse.json({
        error: 'Provisioning a Twilio number may create monthly charges. Resubmit with confirm:true after the user approves.',
        requiresConfirmation: true,
        phoneNumber: normalized.e164,
      }, { status: 409 })
    }

    const existing = await db.companyPhoneNumber.findUnique({ where: { phoneNumber: normalized.e164 } }).catch(() => null)
    if (existing) return NextResponse.json({ error: 'That number is already saved in Jobrolo.' }, { status: 409 })

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
    const purchased = await buyTwilioPhoneNumber({
      phoneNumber: normalized.e164,
      friendlyName: body.friendlyName || `${ctx.contractor.company || ctx.contractor.name} Jobrolo`,
      smsUrl: appUrl ? `${appUrl}/api/twilio/inbound/sms` : null,
      voiceUrl: appUrl ? `${appUrl}/api/twilio/inbound/voice` : null,
    })

    const record = await db.companyPhoneNumber.create({
      data: {
        contractorId: ctx.contractorId,
        provider: 'twilio',
        phoneNumber: purchased.phoneNumber,
        phoneNumberSid: purchased.sid || undefined,
        friendlyName: purchased.friendlyName || body.friendlyName || undefined,
        purpose: body.purpose?.trim() || 'company',
        status: 'active',
        areaCode: purchased.phoneNumber.replace(/[^\d]/g, '').slice(1, 4) || undefined,
        capabilitiesJson: JSON.stringify(purchased.capabilities || {}),
        a2pStatus: 'not_configured',
        metadataJson: JSON.stringify({
          purchasedByUserId: ctx.user.id,
          requiresA2p10DlcForUsBusinessSms: true,
          inboundSmsUrl: appUrl ? `${appUrl}/api/twilio/inbound/sms` : null,
          inboundVoiceUrl: appUrl ? `${appUrl}/api/twilio/inbound/voice` : null,
        }),
      },
    })

    await audit(ctx, 'provision_company_phone_number', 'company_phone_number', record.id, `Provisioned ${record.phoneNumber}`, { provider: 'twilio', phoneNumberSid: record.phoneNumberSid }, req)
    return NextResponse.json({
      success: true,
      number: record,
      note: 'Number saved. US business texting may still require A2P 10DLC registration before high-volume customer messaging.',
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 })
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 })
    console.error('[company-phone-numbers/provision] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not provision company phone number' }, { status: 500 })
  }
}
