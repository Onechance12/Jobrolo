import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { requireAnyRoleResponse } from '@/lib/security/permissions'
import { getTemplateReview } from '@/lib/template-intake'
import { sanitizeHtml } from '@/lib/security/html'

const FieldSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  type: z.string().default('text'),
  variable: z.string().optional().nullable(),
  required: z.boolean().optional().default(false),
  defaultValue: z.string().optional().nullable(),
  mappedSource: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
  metadataJson: z.string().optional().nullable(),
})

const ClauseSchema = z.object({
  title: z.string().optional().nullable(),
  body: z.string().min(1),
  clauseType: z.string().default('general'),
  editable: z.boolean().optional().default(true),
  required: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional(),
  aiNotes: z.string().optional().nullable(),
  metadataJson: z.string().optional().nullable(),
})

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  reviewStatus: z.string().optional(),
  bodyHtml: z.string().min(1).optional(),
  variables: z.array(z.string()).optional(),
  requiresSignature: z.boolean().optional(),
  fields: z.array(FieldSchema).optional(),
  clauses: z.array(ClauseSchema).optional(),
  signatureFields: z.array(FieldSchema).optional(),
  parseWarnings: z.array(z.string()).optional(),
  changeSummary: z.string().max(500).optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { id } = await params
  const review = await getTemplateReview(ctx.contractorId, id)
  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(review)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager', 'project_manager', 'coordinator'])
  if (roleErr) return roleErr
  const { id } = await params
  const parsed = UpdateTemplateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const existing = await db.documentTemplate.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const input = parsed.data

  const reviewStatus = input.reviewStatus ?? (input.status === 'archived' ? 'archived' : input.status)
  const variables = input.variables
    ?? [...new Set([
      ...(input.fields ?? []).map(f => f.variable).filter(Boolean) as string[],
      ...(input.signatureFields ?? []).map(f => f.variable).filter(Boolean) as string[],
    ])]

  const updated = await db.$transaction(async tx => {
    const template = await tx.documentTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(reviewStatus !== undefined ? { reviewStatus } : {}),
        ...(input.bodyHtml !== undefined ? { bodyHtml: sanitizeHtml(input.bodyHtml) } : {}),
        ...(variables.length ? { variablesJson: JSON.stringify(variables) } : input.variables !== undefined ? { variablesJson: JSON.stringify([]) } : {}),
        ...(input.requiresSignature !== undefined ? { requiresSignature: input.requiresSignature } : {}),
        ...(input.fields !== undefined ? { detectedFieldsJson: JSON.stringify(input.fields) } : {}),
        ...(input.clauses !== undefined ? { clausesJson: JSON.stringify(input.clauses) } : {}),
        ...(input.signatureFields !== undefined ? { signatureFieldsJson: JSON.stringify(input.signatureFields) } : {}),
        ...(input.parseWarnings !== undefined ? { parseWarningsJson: JSON.stringify(input.parseWarnings) } : {}),
        ...(input.status === 'archived' ? { archivedAt: new Date() } : {}),
      },
    })

    if (input.fields !== undefined) {
      await tx.documentTemplateField.deleteMany({ where: { contractorId: ctx.contractorId, templateId: id } })
      if (input.fields.length) {
        await tx.documentTemplateField.createMany({
          data: input.fields.map((field, index) => ({
            contractorId: ctx.contractorId,
            templateId: id,
            uploadId: existing.sourceUploadId,
            fieldKey: field.fieldKey,
            label: field.label,
            type: field.type,
            variable: field.variable ?? undefined,
            required: field.required,
            defaultValue: field.defaultValue ?? undefined,
            mappedSource: field.mappedSource ?? undefined,
            instructions: field.instructions ?? undefined,
            sortOrder: field.sortOrder ?? index,
            metadataJson: field.metadataJson ?? undefined,
          })),
        })
      }
    }

    if (input.clauses !== undefined) {
      await tx.documentTemplateClause.deleteMany({ where: { contractorId: ctx.contractorId, templateId: id } })
      if (input.clauses.length) {
        await tx.documentTemplateClause.createMany({
          data: input.clauses.map((clause, index) => ({
            contractorId: ctx.contractorId,
            templateId: id,
            uploadId: existing.sourceUploadId,
            title: clause.title ?? undefined,
            body: clause.body,
            clauseType: clause.clauseType,
            editable: clause.editable,
            required: clause.required,
            sortOrder: clause.sortOrder ?? index,
            aiNotes: clause.aiNotes ?? undefined,
            metadataJson: clause.metadataJson ?? undefined,
          })),
        })
      }
    }

    const versionCount = await tx.documentTemplateVersion.count({ where: { contractorId: ctx.contractorId, templateId: id } })
    await tx.documentTemplateVersion.create({
      data: {
        contractorId: ctx.contractorId,
        templateId: id,
        version: versionCount + 1,
        status: input.status === 'archived' ? 'archived' : 'snapshot',
        bodyHtml: template.bodyHtml,
        fieldsJson: input.fields !== undefined ? JSON.stringify(input.fields) : template.detectedFieldsJson,
        clausesJson: input.clauses !== undefined ? JSON.stringify(input.clauses) : template.clausesJson,
        changeSummary: input.changeSummary || 'Template edited during human review',
        createdById: ctx.user?.id,
      },
    })

    return template
  })

  return NextResponse.json({ template: updated })
}
