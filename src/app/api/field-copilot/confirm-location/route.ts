import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { confirmLocationResolution } from '@/lib/field-copilot'

const ConfirmSchema = z.object({
  resolutionId: z.string().min(1),
  projectId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  canvassingLeadId: z.string().optional().nullable(),
  documentId: z.string().optional().nullable(),
  attachDocument: z.boolean().default(false),
})

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = ConfirmSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { resolutionId, ...options } = parsed.data
  const resolution = await confirmLocationResolution(ctx, resolutionId, options)
  if (!resolution) return NextResponse.json({ error: 'Resolution not found' }, { status: 404 })
  return NextResponse.json({ resolution })
}
