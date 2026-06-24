import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { checkBodySize } from '@/lib/security/body-size'
import { finalizeSignedDocument } from '@/lib/final-documents'
import { queueSignedDocumentCopy, createRoleNotification } from '@/lib/notifications'

const SignSchema = z.object({
  token: z.string().min(10),
  signerName: z.string().min(1).max(200),
  signatureData: z.string().min(1).max(100_000),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sizeErr = checkBodySize(req, 128_000)
  if (sizeErr) return sizeErr
  const { id } = await params
  const contentType = req.headers.get('content-type') ?? ''
  let body: unknown
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    body = {
      token: String(form.get('token') ?? ''),
      signerName: String(form.get('signerName') ?? ''),
      signatureData: String(form.get('signatureData') ?? ''),
    }
  } else {
    body = await req.json()
  }
  const parsed = SignSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data

  const existing = await db.signatureRequest.findFirst({
    where: { id, signatureToken: input.token, status: { in: ['pending', 'viewed'] } },
    include: { generatedDocument: true },
  })
  if (!existing) return NextResponse.json({ error: 'Signature request not found or already completed' }, { status: 404 })
  if (existing.expiresAt && existing.expiresAt < new Date()) {
    await db.signatureRequest.update({ where: { id }, data: { status: 'expired' } })
    return NextResponse.json({ error: 'Signature request expired' }, { status: 410 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? undefined
  const ua = req.headers.get('user-agent') ?? undefined
  const signed = await db.signatureRequest.update({
    where: { id },
    data: {
      status: 'signed',
      signedAt: new Date(),
      signedIp: ip,
      signedUserAgent: ua,
      signerName: input.signerName,
      signatureData: input.signatureData,
      auditJson: JSON.stringify({ signedAt: new Date().toISOString(), ip, userAgent: ua, signerName: input.signerName }),
      events: { create: { contractorId: existing.contractorId, type: 'signed', detail: `Signed by ${input.signerName}`, ipAddress: ip, userAgent: ua } },
    },
  })
  await db.generatedDocument.update({ where: { id: existing.generatedDocumentId }, data: { status: 'signed' } }).catch(() => null)
  let signedPdfUrl: string | null = null
  try {
    const final = await finalizeSignedDocument({ contractorId: existing.contractorId, signatureRequestId: id, postToThread: true })
    signedPdfUrl = final.pdfUrl
  } catch (err) {
    console.error('[signature] final signed PDF generation failed:', err)
  }
  try {
    await queueSignedDocumentCopy({ contractorId: existing.contractorId, signatureRequestId: id, signedPdfUrl })
    await createRoleNotification({
      contractorId: existing.contractorId,
      role: 'project_manager',
      projectId: existing.projectId,
      customerId: existing.customerId,
      type: 'signature_completed',
      title: `Document signed: ${existing.title}`,
      summary: `Signed by ${input.signerName}`,
      priority: 'normal',
      relatedType: 'signature_request',
      relatedId: id,
      payload: { signatureRequestId: id, generatedDocumentId: existing.generatedDocumentId, signedPdfUrl },
    })
  } catch (err) {
    console.error('[signature] notification queue failed:', err)
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    return new NextResponse('<html><body style="font-family:system-ui;padding:40px"><h1>Signed</h1><p>Thank you. The document has been signed and the final copy has been saved to the job packet.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  return NextResponse.json({ signatureRequest: signed, signedPdfUrl })
}
