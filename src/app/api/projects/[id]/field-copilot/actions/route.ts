import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { executeFieldAction } from '@/lib/field-copilot'

const FieldActionSchema = z.object({
  appointmentId: z.string().optional().nullable(),
  fieldVisitId: z.string().optional().nullable(),
  action: z.string().min(1),
  mode: z.string().optional().nullable(),
  note: z.string().max(5000).optional().nullable(),
  materialName: z.string().max(500).optional().nullable(),
  quantity: z.string().max(200).optional().nullable(),
  photoDocumentIds: z.array(z.string()).optional().nullable(),
  signatureRequestId: z.string().optional().nullable(),
  location: z.object({
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    accuracyMeters: z.number().optional().nullable(),
    source: z.string().optional().nullable(),
  }).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id: projectId } = await params
  const parsed = FieldActionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const result = await executeFieldAction(ctx, { projectId, ...parsed.data })
  if (!result) return NextResponse.json({ error: 'Project not found or action could not be logged' }, { status: 404 })
  return NextResponse.json(result, { status: 201 })
}
