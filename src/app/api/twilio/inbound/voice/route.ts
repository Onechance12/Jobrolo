import { validateTwilioWebhook } from '@/lib/twilio-webhook'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const rawBody = await req.text().catch(() => '')
  const params = new URLSearchParams(rawBody)
  if (!validateTwilioWebhook(req, params)) {
    return new NextResponse('Invalid Twilio signature', { status: 403 })
  }
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thanks for calling. Jobrolo voice routing is not configured for this number yet.</Say></Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  )
}
