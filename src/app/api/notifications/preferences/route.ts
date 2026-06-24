import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { getNotificationPreferences, upsertNotificationPreference } from '@/lib/notifications'

const PreferenceSchema = z.object({
  role: z.string().max(80).optional().nullable(),
  userId: z.string().optional().nullable(),
  inAppEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  urgentOnly: z.boolean().optional(),
  dailyDigest: z.boolean().optional(),
  mutedTypes: z.array(z.string().max(80)).optional(),
  quietHours: z.record(z.string(), z.unknown()).optional().nullable(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  return NextResponse.json(await getNotificationPreferences(ctx))
}

export async function PATCH(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = PreferenceSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const preference = await upsertNotificationPreference(ctx, parsed.data)
  return NextResponse.json({ preference })
}
