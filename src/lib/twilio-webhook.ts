import type { NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

export function validateTwilioWebhook(req: NextRequest, params: URLSearchParams) {
  if (process.env.TWILIO_WEBHOOK_VALIDATE === 'false' && process.env.NODE_ENV !== 'production') return true
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const signature = req.headers.get('x-twilio-signature') || ''
  if (!authToken) return process.env.NODE_ENV !== 'production'
  if (!signature) return false

  const url = externalRequestUrl(req)
  const expected = signTwilioRequest(url, params, authToken)
  return safeEqual(signature, expected)
}

function externalRequestUrl(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
  const parsed = new URL(req.url)
  return `${proto}://${host}${parsed.pathname}${parsed.search}`
}

function signTwilioRequest(url: string, params: URLSearchParams, authToken: string) {
  const sortedKeys = Array.from(new Set(Array.from(params.keys()))).sort()
  let payload = url
  for (const key of sortedKeys) {
    const values = params.getAll(key).sort()
    for (const value of values) payload += `${key}${value}`
  }
  return createHmac('sha1', authToken).update(payload).digest('base64')
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
