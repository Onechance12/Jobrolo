import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { createTemplateUploadFromDocument } from '@/lib/template-intake'

const CreateUploadSchema = z.object({
  documentId: z.string().min(1),
  templateType: z.string().optional(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? undefined
  const templateType = searchParams.get('type') ?? undefined
  const uploads = await db.documentTemplateUpload.findMany({
    where: {
      contractorId: ctx.contractorId,
      ...(status && status !== 'all' ? { status } : {}),
      ...(templateType ? { templateType } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ uploads })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const parsed = CreateUploadSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const upload = await createTemplateUploadFromDocument(ctx, parsed.data)
  return NextResponse.json({ upload }, { status: 201 })
}
