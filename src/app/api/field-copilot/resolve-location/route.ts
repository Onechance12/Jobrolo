import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { resolveFieldEntity } from '@/lib/field-copilot'

const LocationSchema = z.object({
  projectId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  appointmentId: z.string().optional().nullable(),
  fieldVisitId: z.string().optional().nullable(),
  documentId: z.string().optional().nullable(),
  canvassingLeadId: z.string().optional().nullable(),
  mode: z.string().optional().nullable(),
  takenAt: z.string().optional().nullable(),
  uploadedAt: z.string().optional().nullable(),
  currentLocation: z.object({
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    accuracyMeters: z.number().optional().nullable(),
    source: z.string().optional().nullable(),
  }).optional().nullable(),
  photoExifLocation: z.object({
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    accuracyMeters: z.number().optional().nullable(),
    source: z.string().optional().nullable(),
  }).optional().nullable(),
})

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = LocationSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const result = await resolveFieldEntity(ctx, parsed.data)
  return NextResponse.json(result)
}
