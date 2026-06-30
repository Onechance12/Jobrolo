import { normalizePhoneE164 } from '@/lib/phone'

type TwilioJson = Record<string, any>

function twilioAccountSid() { return process.env.TWILIO_ACCOUNT_SID || '' }
function twilioAuthToken() { return process.env.TWILIO_AUTH_TOKEN || '' }

function twilioAuthHeader() {
  const sid = twilioAccountSid()
  const token = twilioAuthToken()
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
}

export function twilioCoreConfigured() {
  return Boolean(twilioAccountSid() && twilioAuthToken())
}

export function twilioVerifyConfigured() {
  return Boolean(twilioCoreConfigured() && process.env.TWILIO_VERIFY_SERVICE_SID)
}

export function twilioPhoneProvisioningConfigured() {
  return twilioCoreConfigured()
}

async function twilioPost(path: string, params: URLSearchParams): Promise<TwilioJson> {
  if (!twilioCoreConfigured()) throw new Error('Twilio credentials are not configured')
  const sid = twilioAccountSid()
  const res = await fetch(`https://api.twilio.com${path.replace(':AccountSid', sid)}`, {
    method: 'POST',
    headers: {
      Authorization: twilioAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(twilioErrorMessage(data, res.status))
  return data
}

async function twilioGet(path: string): Promise<TwilioJson> {
  if (!twilioCoreConfigured()) throw new Error('Twilio credentials are not configured')
  const sid = twilioAccountSid()
  const res = await fetch(`https://api.twilio.com${path.replace(':AccountSid', sid)}`, {
    headers: { Authorization: twilioAuthHeader() },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(twilioErrorMessage(data, res.status))
  return data
}

function twilioErrorMessage(data: TwilioJson, status: number) {
  const message = data?.message || data?.detail || data?.error || `Twilio request failed with status ${status}`
  const code = data?.code ? ` (${data.code})` : ''
  return `${message}${code}`.slice(0, 700)
}

export async function startTwilioVerify(phoneE164: string) {
  if (!twilioVerifyConfigured()) throw new Error('Twilio Verify is not configured')
  return twilioPost(`/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/Verifications`, new URLSearchParams({
    To: phoneE164,
    Channel: 'sms',
  }))
}

export async function checkTwilioVerify(phoneE164: string, code: string) {
  if (!twilioVerifyConfigured()) throw new Error('Twilio Verify is not configured')
  const result = await twilioPost(`/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`, new URLSearchParams({
    To: phoneE164,
    Code: code.trim(),
  }))
  return {
    ok: result.status === 'approved' || result.valid === true,
    status: String(result.status || ''),
    sid: result.sid ? String(result.sid) : null,
  }
}

export async function searchTwilioLocalNumbers(input: { areaCode?: string | null; contains?: string | null; limit?: number | null }) {
  const params = new URLSearchParams()
  const areaCode = String(input.areaCode || '').replace(/[^\d]/g, '').slice(0, 3)
  const contains = String(input.contains || '').replace(/[^\d*]/g, '').slice(0, 16)
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 20)
  if (areaCode.length === 3) params.set('AreaCode', areaCode)
  if (contains) params.set('Contains', contains)
  params.set('SmsEnabled', 'true')
  params.set('VoiceEnabled', 'true')
  params.set('PageSize', String(limit))
  const query = params.toString()
  const data = await twilioGet(`/2010-04-01/Accounts/:AccountSid/AvailablePhoneNumbers/US/Local.json${query ? `?${query}` : ''}`)
  return (data.available_phone_numbers || []).slice(0, limit).map((number: any) => ({
    phoneNumber: String(number.phone_number || ''),
    friendlyName: number.friendly_name ? String(number.friendly_name) : null,
    locality: number.locality ? String(number.locality) : null,
    region: number.region ? String(number.region) : null,
    postalCode: number.postal_code ? String(number.postal_code) : null,
    capabilities: number.capabilities || {},
  }))
}

export async function buyTwilioPhoneNumber(input: { phoneNumber: string; friendlyName?: string | null; smsUrl?: string | null; voiceUrl?: string | null }) {
  const normalized = normalizePhoneE164(input.phoneNumber)
  if (!normalized.ok) throw new Error(normalized.error)
  const params = new URLSearchParams({ PhoneNumber: normalized.e164 })
  if (input.friendlyName) params.set('FriendlyName', input.friendlyName)
  if (input.smsUrl) params.set('SmsUrl', input.smsUrl)
  if (input.voiceUrl) params.set('VoiceUrl', input.voiceUrl)
  const data = await twilioPost('/2010-04-01/Accounts/:AccountSid/IncomingPhoneNumbers.json', params)
  return {
    sid: data.sid ? String(data.sid) : null,
    phoneNumber: String(data.phone_number || normalized.e164),
    friendlyName: data.friendly_name ? String(data.friendly_name) : null,
    capabilities: data.capabilities || {},
    status: data.status ? String(data.status) : 'active',
  }
}
