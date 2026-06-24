import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { bulkAddPhotosToRoofReport, getRoofReportWorkspace } from '@/lib/roof-reports'

const PhotoSchema = z.object({
  documentId: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z.string().default('other'),
  area: z.string().optional(),
  condition: z.string().optional(),
  severity: z.string().default('informational'),
  caption: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tagsJson: z.string().optional(),
  isIncluded: z.boolean().optional(),
  isCoverPhoto: z.boolean().optional(),
  takenAt: z.string().optional(),
  sortOrder: z.number().int().optional(),
})

const BodySchema = z.object({ photos: z.array(PhotoSchema).min(1).max(100) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const parsed = BodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  try {
    const photos = await bulkAddPhotosToRoofReport(ctx, id, parsed.data.photos)
    const workspace = await getRoofReportWorkspace(ctx, id)
    return NextResponse.json({ photos, workspace }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not add photos' }, { status: 400 })
  }
}
