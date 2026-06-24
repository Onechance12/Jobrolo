import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { requireAnyRoleResponse } from '@/lib/security/permissions'
import { createProjectTimelineEvent } from '@/lib/project-context'
import { buildProjectMergeData, mergeTemplateVariables } from '@/lib/contractor-profile'
import { createUnsignedDocumentPdf } from '@/lib/final-documents'
import { sanitizeHtml } from '@/lib/security/html'

const GeneratedDocSchema = z.object({
  templateId: z.string().optional(),
  projectId: z.string().optional(),
  customerId: z.string().optional(),
  title: z.string().min(1).max(200),
  type: z.string().default('custom'),
  bodyHtml: z.string().optional(),
  mergeData: z.record(z.string(), z.unknown()).optional(),
  createPreviewPdf: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId') ?? undefined
  const customerId = searchParams.get('customerId') ?? undefined
  const docs = await db.generatedDocument.findMany({
    where: { contractorId: ctx.contractorId, ...(projectId ? { projectId } : {}), ...(customerId ? { customerId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ documents: docs })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager', 'project_manager', 'coordinator'])
  if (roleErr) return roleErr
  const parsed = GeneratedDocSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data

  if (!input.projectId && !input.customerId) {
    return NextResponse.json({ error: 'Generated document must be attached to a project or customer' }, { status: 400 })
  }
  if (input.projectId) {
    const project = await db.project.findFirst({ where: { id: input.projectId, contractorId: ctx.contractorId }, select: { id: true, customerId: true } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    input.customerId ??= project.customerId ?? undefined
  }
  if (input.customerId) {
    const customer = await db.customer.findFirst({ where: { id: input.customerId, contractorId: ctx.contractorId }, select: { id: true } })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  let bodyHtml = input.bodyHtml
  if (input.templateId) {
    const template = await db.documentTemplate.findFirst({ where: { id: input.templateId, contractorId: ctx.contractorId, status: 'active' } })
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    if (template.importedFromUpload && template.reviewStatus !== 'approved') {
      return NextResponse.json({ error: 'Imported contractor templates must be reviewed and approved before generating customer-facing documents' }, { status: 400 })
    }
    const mergeContext = await buildProjectMergeData({ contractorId: ctx.contractorId, projectId: input.projectId, customerId: input.customerId, extra: input.mergeData ?? {} })
    bodyHtml = mergeTemplateVariables(template.bodyHtml, mergeContext.data)
    input.mergeData = mergeContext.data
  }
  if (!bodyHtml) return NextResponse.json({ error: 'bodyHtml or templateId required' }, { status: 400 })
  bodyHtml = sanitizeHtml(bodyHtml)

  const doc = await db.generatedDocument.create({
    data: {
      contractorId: ctx.contractorId,
      templateId: input.templateId,
      projectId: input.projectId,
      customerId: input.customerId,
      title: input.title,
      type: input.type,
      bodyHtml,
      mergedDataJson: input.mergeData ? JSON.stringify(input.mergeData) : undefined,
    },
  })
  await createProjectTimelineEvent({
    contractorId: ctx.contractorId,
    projectId: doc.projectId,
    customerId: doc.customerId,
    actorUserId: ctx.user?.id,
    eventType: 'generated_document_created',
    title: `Document generated: ${doc.title}`,
    relatedType: 'generated_document',
    relatedId: doc.id,
    source: 'user',
    metadata: { type: doc.type, templateId: doc.templateId },
  })

  let previewPdf: { documentId: string; url: string } | null = null
  if (input.createPreviewPdf) {
    try {
      const result = await createUnsignedDocumentPdf({ ctx, generatedDocumentId: doc.id, postToThread: true })
      previewPdf = { documentId: result.pdfDocument.id, url: result.pdfUrl }
    } catch (err) {
      console.error('[generated-documents] preview PDF failed:', err)
    }
  }

  return NextResponse.json({ document: doc, previewPdf }, { status: 201 })
}
