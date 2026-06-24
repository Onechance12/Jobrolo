import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { saveFile } from '@/lib/storage'
import { getContractorProfile, publicContractorProfile } from '@/lib/contractor-profile'
import { linkDocumentToJobPacket, createProjectTimelineEvent } from '@/lib/project-context'
import type { TenantContext } from '@/lib/security/context'
import { sanitizeHtml } from '@/lib/security/html'

export type PdfVariant = 'unsigned' | 'signed'

function safeJson<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function safeFileStem(value: string, fallback = 'document') {
  const stem = value
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90)
  return stem || fallback
}

function storagePathFor(filename: string) {
  return path.join(process.cwd(), 'storage', 'private', 'uploads', 'docs', filename)
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function htmlToPlainText(html: string) {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h1|h2|h3|h4|li|tr|section|article)\s*>/gi, '\n')
    .replace(/<\s*(h1|h2|h3)\b[^>]*>/gi, '\n\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n• ')
    .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(withBreaks)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapePdfText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

function wrapLine(line: string, maxChars = 88) {
  const words = line.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) current = word
    else if ((current + ' ' + word).length <= maxChars) current += ' ' + word
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function paginateText(text: string) {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) lines.push('')
    else lines.push(...wrapLine(line))
  }
  const perPage = 49
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage))
  return pages.length ? pages : [['']]
}

export function createSimplePdfBuffer(title: string, bodyText: string, footerText?: string) {
  const normalizedTitle = title || 'Jobrolo Document'
  const pages = paginateText(`${normalizedTitle}\n${'='.repeat(Math.min(normalizedTitle.length, 72))}\n\n${bodyText}${footerText ? `\n\n${footerText}` : ''}`)

  const objects: string[] = []
  const add = (obj: string) => { objects.push(obj); return objects.length }

  const catalogId = add('')
  const pagesId = add('')
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds: number[] = []
  const contentIds: number[] = []

  for (let p = 0; p < pages.length; p++) {
    const pageLines = pages[p]
    const content = [
      'BT',
      '/F1 10 Tf',
      '50 760 Td',
      '14 TL',
      ...pageLines.map(line => `(${escapePdfText(line)}) Tj T*`),
      `(${escapePdfText(`Page ${p + 1} of ${pages.length}`)}) Tj`,
      'ET',
    ].join('\n')
    const contentId = add(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`)
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    contentIds.push(contentId)
    pageIds.push(pageId)
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'binary'))
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefStart = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(pdf, 'binary')
}

function renderDocumentShell(opts: {
  title: string
  companyName?: string | null
  companyContact?: string | null
  bodyHtml: string
  statusLabel: string
  certificateHtml?: string | null
  legalFooter?: string | null
}) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>
  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#0f172a;}
  .page{max-width:850px;margin:0 auto;padding:48px;}
  .header{border-bottom:1px solid #cbd5e1;padding-bottom:18px;margin-bottom:28px;}
  .kicker{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#0369a1;font-weight:700;}
  h1{font-size:28px;margin:8px 0 4px;}
  .status{display:inline-block;border:1px solid #94a3b8;border-radius:999px;padding:4px 10px;font-size:12px;margin-top:8px;background:white;}
  .doc{background:white;border:1px solid #e2e8f0;border-radius:18px;padding:30px;box-shadow:0 10px 25px rgba(15,23,42,.08);}
  .certificate{margin-top:24px;border:1px solid #86efac;background:#f0fdf4;border-radius:16px;padding:18px;}
  .footer{margin-top:18px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:14px;}
  @media print{body{background:white}.page{padding:24px}.doc{box-shadow:none}}
</style></head><body><main class="page">
  <header class="header"><div class="kicker">${escapeHtml(opts.companyName || 'Jobrolo Document')}</div><h1>${escapeHtml(opts.title)}</h1>${opts.companyContact ? `<div>${escapeHtml(opts.companyContact)}</div>` : ''}<div class="status">${escapeHtml(opts.statusLabel)}</div></header>
  <section class="doc">${sanitizeHtml(opts.bodyHtml)}</section>
  ${opts.certificateHtml || ''}
  ${opts.legalFooter ? `<div class="footer">${escapeHtml(opts.legalFooter)}</div>` : ''}
</main></body></html>`
}

function certificateForSignature(request: any) {
  const cert = {
    signatureRequestId: request.id,
    generatedDocumentId: request.generatedDocumentId,
    signerName: request.signerName,
    signerEmail: request.signerEmail ?? null,
    signerPhone: request.signerPhone ?? null,
    signedAt: request.signedAt ? new Date(request.signedAt).toISOString() : new Date().toISOString(),
    signedIp: request.signedIp ?? null,
    signedUserAgent: request.signedUserAgent ?? null,
    signatureData: request.signatureData ?? null,
  }
  return cert
}

function certificateHtml(cert: ReturnType<typeof certificateForSignature>) {
  return `<section class="certificate"><h2 style="margin:0 0 8px;font-size:18px;">Electronic Signature Certificate</h2>
  <p style="margin:0 0 10px;">Signed by <strong>${escapeHtml(cert.signerName)}</strong>${cert.signerEmail ? ` (${escapeHtml(cert.signerEmail)})` : ''}.</p>
  <dl style="display:grid;grid-template-columns:160px 1fr;gap:6px 12px;font-size:13px;margin:0;">
    <dt>Signed at</dt><dd>${escapeHtml(cert.signedAt)}</dd>
    <dt>Signature request</dt><dd>${escapeHtml(cert.signatureRequestId)}</dd>
    <dt>Document</dt><dd>${escapeHtml(cert.generatedDocumentId)}</dd>
    ${cert.signedIp ? `<dt>IP address</dt><dd>${escapeHtml(cert.signedIp)}</dd>` : ''}
    ${cert.signedUserAgent ? `<dt>User agent</dt><dd>${escapeHtml(cert.signedUserAgent)}</dd>` : ''}
    ${cert.signatureData ? `<dt>Signature capture</dt><dd>${escapeHtml(String(cert.signatureData).slice(0, 300))}</dd>` : ''}
  </dl></section>`
}

async function createFileDocument(input: {
  contractorId: string
  projectId?: string | null
  customerId?: string | null
  buffer: Buffer
  filename: string
  originalName: string
  fileType: string
  aiSummary?: string
  uploadedById?: string | null
}) {
  const stored = await saveFile({ buffer: input.buffer, filename: input.filename, mimeType: 'application/pdf', directory: 'docs' })
  const doc = await db.document.create({
    data: {
      contractorId: input.contractorId,
      projectId: input.projectId ?? undefined,
      customerId: input.customerId ?? undefined,
      filename: stored.filename,
      originalName: input.originalName,
      mimeType: 'application/pdf',
      size: stored.size,
      filePath: stored.filePath,
      fileType: input.fileType,
      aiCategory: input.fileType,
      aiSummary: input.aiSummary ?? undefined,
      status: 'ready',
      uploadedById: input.uploadedById ?? undefined,
    },
  })
  return { document: doc, url: stored.url }
}

async function getWorkspaceMainChat(contractorId: string, projectId?: string | null) {
  if (!projectId) return null
  const workspace = await db.workspace.findFirst({
    where: { contractorId, projectId },
    include: { chats: { where: { chatType: 'main' }, take: 1 } },
  })
  return workspace?.chats?.[0] ?? null
}

async function postDocumentCardToThread(input: {
  contractorId: string
  projectId?: string | null
  content: string
  contextType: string
  contextData: Record<string, unknown>
}) {
  const chat = await getWorkspaceMainChat(input.contractorId, input.projectId)
  if (!chat) return null
  return db.workspaceMessage.create({
    data: {
      chatId: chat.id,
      role: 'assistant',
      content: input.content,
      contextType: input.contextType,
      contextData: JSON.stringify(input.contextData),
    },
  }).catch(() => null)
}

export async function createUnsignedDocumentPdf(input: {
  ctx: TenantContext
  generatedDocumentId: string
  postToThread?: boolean
}) {
  const doc = await db.generatedDocument.findFirst({ where: { id: input.generatedDocumentId, contractorId: input.ctx.contractorId } })
  if (!doc) throw new Error('Generated document not found')
  const profile = publicContractorProfile(await getContractorProfile(doc.contractorId))
  const contact = [profile?.phone, profile?.email, profile?.website].filter(Boolean).join(' • ')
  const html = renderDocumentShell({
    title: doc.title,
    companyName: profile?.displayName,
    companyContact: contact,
    bodyHtml: sanitizeHtml(doc.bodyHtml),
    statusLabel: 'Unsigned Preview',
    legalFooter: profile?.legalFooter,
  })
  const bodyText = htmlToPlainText(html)
  const pdf = createSimplePdfBuffer(doc.title, bodyText, 'Unsigned preview generated by Jobrolo. This is not a signed copy.')
  const filename = `${Date.now()}-${safeFileStem(doc.title)}-${randomBytes(4).toString('hex')}-unsigned.pdf`
  const { document, url } = await createFileDocument({
    contractorId: doc.contractorId,
    projectId: doc.projectId,
    customerId: doc.customerId,
    buffer: pdf,
    filename,
    originalName: `${doc.title} — unsigned preview.pdf`,
    fileType: 'generated_document_pdf',
    aiSummary: `Unsigned PDF preview for generated document ${doc.title}`,
    uploadedById: input.ctx.user?.id,
  })
  await linkDocumentToJobPacket({
    contractorId: doc.contractorId,
    documentId: document.id,
    projectId: doc.projectId,
    customerId: doc.customerId,
    entityType: 'generated_document',
    entityId: doc.id,
    role: 'attachment',
    label: 'Unsigned PDF preview',
    source: 'system',
    metadata: { generatedDocumentId: doc.id, pdfVariant: 'unsigned' },
  })
  const updated = await db.generatedDocument.update({
    where: { id: doc.id },
    data: { unsignedPdfPath: document.filePath, unsignedPdfDocumentId: document.id },
  })
  await createProjectTimelineEvent({
    contractorId: doc.contractorId,
    projectId: doc.projectId,
    customerId: doc.customerId,
    eventType: 'generated_document_pdf_created',
    title: `PDF preview created: ${doc.title}`,
    relatedType: 'generated_document',
    relatedId: doc.id,
    source: 'system',
    actorUserId: input.ctx.user?.id,
    metadata: { documentId: document.id, pdfVariant: 'unsigned' },
  })
  if (input.postToThread) {
    await postDocumentCardToThread({
      contractorId: doc.contractorId,
      projectId: doc.projectId,
      content: `PDF preview ready for ${doc.title}.`,
      contextType: 'generated_document_pdf',
      contextData: { cardType: 'generated_document_pdf', id: doc.id, title: doc.title, status: updated.status, pdfUrl: url, pdfDocumentId: document.id, variant: 'unsigned' },
    })
  }
  return { generatedDocument: updated, pdfDocument: document, pdfUrl: url, htmlSnapshot: html }
}

export async function finalizeSignedDocument(input: {
  contractorId: string
  signatureRequestId: string
  actorUserId?: string | null
  postToThread?: boolean
}) {
  const request = await db.signatureRequest.findFirst({
    where: { id: input.signatureRequestId, contractorId: input.contractorId, status: 'signed' },
    include: { generatedDocument: true, events: { orderBy: { createdAt: 'asc' } } },
  })
  if (!request) throw new Error('Signed request not found')
  const doc = request.generatedDocument
  if (request.signedPdfDocumentId) {
    const existingPdf = await db.document.findFirst({ where: { id: request.signedPdfDocumentId, contractorId: input.contractorId } })
    if (existingPdf) {
      return { generatedDocument: doc, signatureRequest: request, pdfDocument: existingPdf, pdfUrl: `/api/storage/docs/${existingPdf.filename}`, certificate: safeJson(request.certificateJson ?? doc.signatureCertificateJson, {}) }
    }
  }
  const profile = publicContractorProfile(await getContractorProfile(doc.contractorId))
  const cert = certificateForSignature(request)
  const certJson = JSON.stringify({ ...cert, events: request.events.map(e => ({ type: e.type, detail: e.detail, createdAt: e.createdAt.toISOString(), ipAddress: e.ipAddress, userAgent: e.userAgent })) })
  const html = renderDocumentShell({
    title: doc.title,
    companyName: profile?.displayName,
    companyContact: [profile?.phone, profile?.email, profile?.website].filter(Boolean).join(' • '),
    bodyHtml: sanitizeHtml(doc.bodyHtml),
    statusLabel: 'Signed Final Copy',
    certificateHtml: certificateHtml(cert),
    legalFooter: profile?.legalFooter,
  })
  const text = htmlToPlainText(html)
  const pdf = createSimplePdfBuffer(`${doc.title} — Signed`, text, 'Final signed copy generated by Jobrolo. The signature certificate and audit information are included above.')
  const filename = `${Date.now()}-${safeFileStem(doc.title)}-${randomBytes(4).toString('hex')}-signed.pdf`
  const { document: pdfDocument, url } = await createFileDocument({
    contractorId: doc.contractorId,
    projectId: doc.projectId,
    customerId: doc.customerId,
    buffer: pdf,
    filename,
    originalName: `${doc.title} — signed.pdf`,
    fileType: 'signed_document',
    aiSummary: `Final signed PDF for ${doc.title}. Signed by ${request.signerName}.`,
    uploadedById: input.actorUserId,
  })
  await linkDocumentToJobPacket({
    contractorId: doc.contractorId,
    documentId: pdfDocument.id,
    projectId: doc.projectId,
    customerId: doc.customerId,
    entityType: 'signature_request',
    entityId: request.id,
    role: 'signed_copy',
    label: 'Final signed PDF',
    source: 'system',
    metadata: { generatedDocumentId: doc.id, signatureRequestId: request.id, signerName: request.signerName },
  })
  await db.signatureRequest.update({
    where: { id: request.id },
    data: { signedPdfPath: pdfDocument.filePath, signedPdfDocumentId: pdfDocument.id, certificateJson: certJson },
  })
  const updatedDoc = await db.generatedDocument.update({
    where: { id: doc.id },
    data: {
      status: 'signed',
      signedPdfPath: pdfDocument.filePath,
      signedPdfDocumentId: pdfDocument.id,
      signatureCertificateJson: certJson,
      finalizedAt: new Date(),
    },
  })
  await createProjectTimelineEvent({
    contractorId: doc.contractorId,
    projectId: doc.projectId,
    customerId: doc.customerId,
    eventType: 'signed_pdf_created',
    title: `Signed PDF saved: ${doc.title}`,
    body: `Signed by ${request.signerName}. Final PDF saved to the job packet.`,
    relatedType: 'signature_request',
    relatedId: request.id,
    source: 'system',
    actorUserId: input.actorUserId,
    metadata: { generatedDocumentId: doc.id, signedPdfDocumentId: pdfDocument.id, signerName: request.signerName },
  })
  if (input.postToThread !== false) {
    await postDocumentCardToThread({
      contractorId: doc.contractorId,
      projectId: doc.projectId,
      content: `${doc.title} was signed by ${request.signerName}. The final PDF is saved to the job packet.`,
      contextType: 'signed_document',
      contextData: { cardType: 'signed_document', title: doc.title, signerName: request.signerName, signedAt: cert.signedAt, pdfUrl: url, pdfDocumentId: pdfDocument.id, generatedDocumentId: doc.id, signatureRequestId: request.id },
    })
  }
  return { generatedDocument: updatedDoc, signatureRequest: request, pdfDocument, pdfUrl: url, certificate: safeJson(certJson, {}) }
}

export async function getSignedDocumentArtifacts(ctx: TenantContext, generatedDocumentId: string) {
  const doc = await db.generatedDocument.findFirst({ where: { id: generatedDocumentId, contractorId: ctx.contractorId } })
  if (!doc) throw new Error('Generated document not found')
  let unsignedPdfUrl: string | null = null
  let signedPdfUrl: string | null = null
  if (doc.unsignedPdfDocumentId) {
    const d = await db.document.findFirst({ where: { id: doc.unsignedPdfDocumentId, contractorId: ctx.contractorId }, select: { filePath: true, filename: true } })
    unsignedPdfUrl = d ? `/api/storage/docs/${d.filename}` : null
  }
  if (doc.signedPdfDocumentId) {
    const d = await db.document.findFirst({ where: { id: doc.signedPdfDocumentId, contractorId: ctx.contractorId }, select: { filePath: true, filename: true } })
    signedPdfUrl = d ? `/api/storage/docs/${d.filename}` : null
  }
  return { generatedDocument: doc, unsignedPdfUrl, signedPdfUrl, certificate: safeJson(doc.signatureCertificateJson, null) }
}
