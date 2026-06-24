import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { requireAnyRoleResponse } from '@/lib/security/permissions'
import { createProjectTimelineEvent } from '@/lib/project-context'
import { createUnsignedDocumentPdf } from '@/lib/final-documents'
import { queueSignatureRequestDelivery, createRoleNotification } from '@/lib/notifications'

const SignatureRequestSchema = z.object({
  generatedDocumentId: z.string(),
  projectId: z.string().optional(),
  customerId: z.string().optional(),
  title: z.string().min(1).max(200),
  signerName: z.string().min(1).max(200),
  signerEmail: z.string().email().optional(),
  signerPhone: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? undefined
  const requests = await db.signatureRequest.findMany({
    where: { contractorId: ctx.contractorId, ...(status ? { status } : {}) },
    include: { generatedDocument: true, events: { orderBy: { createdAt: 'desc' }, take: 10 } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ signatureRequests: requests })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager', 'project_manager', 'coordinator'])
  if (roleErr) return roleErr
  const parsed = SignatureRequestSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data

  const document = await db.generatedDocument.findFirst({ where: { id: input.generatedDocumentId, contractorId: ctx.contractorId } })
  if (!document) return NextResponse.json({ error: 'Generated document not found' }, { status: 404 })

  const token = `sig_${randomBytes(24).toString('base64url')}`
  const request = await db.signatureRequest.create({
    data: {
      contractorId: ctx.contractorId,
      generatedDocumentId: input.generatedDocumentId,
      projectId: input.projectId ?? document.projectId,
      customerId: input.customerId ?? document.customerId,
      title: input.title,
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      signerPhone: input.signerPhone,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      signatureToken: token,
      events: {
        create: { contractorId: ctx.contractorId, type: 'created', detail: `Signature request created for ${input.signerName}` },
      },
    },
    include: { events: true },
  })

  await db.generatedDocument.update({ where: { id: document.id }, data: { status: 'sent' } }).catch(() => null)
  await createProjectTimelineEvent({
    contractorId: ctx.contractorId,
    projectId: request.projectId,
    customerId: request.customerId,
    actorUserId: ctx.user?.id,
    eventType: 'signature_request_created',
    title: `Signature request created: ${request.title}`,
    body: `Signer: ${request.signerName}`,
    relatedType: 'signature_request',
    relatedId: request.id,
    source: 'user',
    metadata: { generatedDocumentId: document.id },
  })
  let previewPdf: { documentId: string; url: string } | null = null
  try {
    const result = await createUnsignedDocumentPdf({ ctx, generatedDocumentId: document.id, postToThread: false })
    previewPdf = { documentId: result.pdfDocument.id, url: result.pdfUrl }
  } catch (err) {
    console.error('[signature-requests] unsigned PDF preview failed:', err)
  }
  try {
    await queueSignatureRequestDelivery({ contractorId: ctx.contractorId, signatureRequestId: request.id })
    await createRoleNotification({
      contractorId: ctx.contractorId,
      role: 'project_manager',
      projectId: request.projectId,
      customerId: request.customerId,
      type: 'signature_request_sent',
      title: `Signature request sent: ${request.title}`,
      summary: `Signer: ${request.signerName}`,
      priority: 'normal',
      relatedType: 'signature_request',
      relatedId: request.id,
      payload: { signatureRequestId: request.id, generatedDocumentId: document.id },
    })
  } catch (err) {
    console.error('[signature-requests] notification queue failed:', err)
  }
  return NextResponse.json({ signatureRequest: request, signingUrl: `/sign/${token}`, previewPdf }, { status: 201 })
}
