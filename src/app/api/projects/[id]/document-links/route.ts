import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { requireProject } from '@/lib/security/ownership'
import { checkBodySize } from '@/lib/security/body-size'
import { linkDocumentToJobPacket } from '@/lib/project-context'

const LinkSchema = z.object({
  documentId: z.string().min(1),
  customerId: z.string().optional(),
  entityType: z.string().default('project'),
  entityId: z.string().optional(),
  role: z.string().default('attachment'),
  label: z.string().optional(),
  notes: z.string().optional(),
  metadata: z.unknown().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const project = await requireProject(ctx, id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const links = await db.documentLink.findMany({
    where: { contractorId: ctx.contractorId, projectId: id },
    orderBy: { createdAt: 'desc' },
    take: 250,
  })
  return NextResponse.json({ links })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const project = await requireProject(ctx, id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = LinkSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  const link = await linkDocumentToJobPacket({
    contractorId: ctx.contractorId,
    documentId: input.documentId,
    projectId: id,
    customerId: input.customerId ?? project.customerId,
    entityType: input.entityType,
    entityId: input.entityId ?? id,
    role: input.role,
    label: input.label,
    notes: input.notes,
    source: 'user',
    metadata: input.metadata,
  })
  if (!link) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  return NextResponse.json({ link }, { status: 201 })
}
