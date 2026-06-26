'use client'

import type { MessageAttachment } from '@/lib/types'

export type UploadedDocument = {
  id: string
  originalName: string
  fileType: string
  mimeType: string
  size: number
  status: string
  url: string | null
  thumbnailUrl?: string | null
}

export type UploadBatchResult = {
  documents: UploadedDocument[]
  failures: Array<{ fileName: string; error: string }>
  needsLink: boolean
  deferLinkPrompt?: boolean
  suggestedPrompt?: string
  uploadContext?: Record<string, unknown>
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function friendlyUploadError(err: unknown) {
  if (err instanceof DOMException && err.name === 'AbortError') return 'Upload stopped'
  if (err instanceof Error) {
    if (err.message === 'Failed to fetch') return 'Network connection dropped before the server responded'
    return err.message
  }
  return String(err)
}

function shouldTryBrowserCompression(file: File) {
  if (!file.type.startsWith('image/')) return false
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return false
  return file.size > 6 * 1024 * 1024
}

async function compressImageForUpload(file: File): Promise<File> {
  if (!shouldTryBrowserCompression(file)) return file
  if (typeof createImageBitmap !== 'function') return file

  try {
    const bitmap = await createImageBitmap(file)
    const maxSide = 2200
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob || blob.size <= 0 || blob.size >= file.size) return file
    const stem = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${stem}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch (err) {
    console.warn('[chat-upload] image compression skipped:', err)
    return file
  }
}

async function uploadOneFile(file: File, fields: Record<string, string>, signal?: AbortSignal) {
  const attempts = [0, 900, 1800]
  let lastError: unknown
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    if (attempt > 0) await wait(attempts[attempt])
    if (signal?.aborted) throw new DOMException('Upload stopped', 'AbortError')

    try {
      const uploadFile = await compressImageForUpload(file)
      const form = new FormData()
      form.append('files', uploadFile)
      for (const [key, value] of Object.entries(fields)) {
        if (value) form.append(key, value)
      }
      const res = await fetch('/api/upload', { method: 'POST', body: form, signal })
      if (!res.ok) {
        let message = `Upload failed (HTTP ${res.status})`
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {}
        throw new Error(message)
      }
      return await res.json()
    } catch (err) {
      lastError = err
      if (signal?.aborted) throw err
      if (attempt === attempts.length - 1) throw err
    }
  }
  throw lastError
}

export async function uploadFilesSequentially(files: File[], opts: { fields?: Record<string, string>; signal?: AbortSignal } = {}): Promise<UploadBatchResult> {
  const documents: UploadedDocument[] = []
  const failures: Array<{ fileName: string; error: string }> = []
  let needsLink = false
  let deferLinkPrompt = false
  let suggestedPrompt: string | undefined
  let uploadContext: Record<string, unknown> | undefined

  for (const file of files) {
    try {
      const data = await uploadOneFile(file, opts.fields ?? {}, opts.signal)
      const docs = (data.documents || []) as UploadedDocument[]
      documents.push(...docs)
      if (data.needsLink) {
        needsLink = true
        deferLinkPrompt = deferLinkPrompt || data.deferLinkPrompt === true
        suggestedPrompt = data.suggestedPrompt
        uploadContext = {
          documentIds: documents.map(d => d.id),
          filenames: documents.map(d => d.originalName),
          fileTypes: documents.map(d => d.fileType),
        }
      }
    } catch (err) {
      failures.push({ fileName: file.name, error: friendlyUploadError(err) })
      if (opts.signal?.aborted) break
    }
  }

  return { documents, failures, needsLink, deferLinkPrompt, suggestedPrompt, uploadContext }
}

export function attachmentFromDocument(doc: UploadedDocument): MessageAttachment {
  return {
    type: doc.fileType === 'photo' ? 'image' : 'file',
    name: doc.originalName,
    url: doc.url || `/api/documents/${doc.id}`,
    thumbnailUrl: doc.thumbnailUrl ?? undefined,
    mimeType: doc.mimeType || (doc.fileType === 'photo' ? 'image/jpeg' : 'application/octet-stream'),
    size: doc.size,
    documentId: doc.id,
    documentStatus: doc.status as MessageAttachment['documentStatus'],
    documentType: doc.fileType,
  }
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function uploadAnalysisFollowupFromDocument(doc: any): { content: string; contextType?: string; contextData?: Record<string, unknown> } | null {
  if (!doc) return null
  const filename = textValue(doc.originalName) || textValue(doc.filename) || 'the upload'
  const documentId = textValue(doc.id)
  const linked = Boolean(doc.customer || doc.project || doc.customerId || doc.projectId || doc.workspaceId)
  const extracted = doc.extractedData && typeof doc.extractedData === 'object' ? doc.extractedData as Record<string, any> : {}
  const category = String(doc.aiCategory || doc.fileType || extracted.documentType || '').toLowerCase()
  const status = String(doc.status || '').toLowerCase()
  const confidence = numberValue(doc.extractionConfidence)

  if (linked) {
    const target = doc.project?.title ? `project "${doc.project.title}"` : doc.customer?.name ? `${doc.customer.name}'s file` : 'the selected job file'
    return {
      content: `Saved and analyzed ${filename}. It is already attached to ${target}.`,
    }
  }

  if (status === 'failed' || status === 'needs_ocr') {
    return {
      content: `Saved ${filename}, but I could not extract enough reliable text from it yet. You can still attach the saved file to a customer/project, or upload a cleaner PDF/photo if you want me to analyze it again.`,
      contextType: 'upload_link_prompt',
      contextData: { documentIds: documentId ? [documentId] : [], filenames: [filename], status },
    }
  }

  if (category.includes('price')) {
    const rows = Array.isArray(extracted.materialItems) ? extracted.materialItems.length : Number(extracted.priceSheetReview?.extractedRowCount ?? 0)
    const supplier = textValue(extracted.supplier) || textValue(extracted.vendor) || textValue(extracted.extractedData?.supplier)
    return {
      content: `Saved and analyzed ${filename}. This looks like a supplier price sheet${supplier ? ` from ${supplier}` : ''}${rows ? ` with ${rows.toLocaleString()} extracted material row${rows === 1 ? '' : 's'}` : ''}. I’m leaving it company-level for review; it is not automatically attached to a client and it has not changed your pricing yet. Ask me to “review the first 10 rows” or “import this price sheet” when you’re ready.`,
      contextType: 'upload_link_prompt',
      contextData: { documentIds: documentId ? [documentId] : [], filenames: [filename], fileTypes: ['price_sheet'], suggestedActions: ['review_price_sheet_items', 'import_price_sheet_items'] },
    }
  }

  const detectedCustomer =
    extracted.customer && typeof extracted.customer === 'object'
      ? extracted.customer as Record<string, unknown>
      : null
  const customerName =
    textValue(detectedCustomer?.name) ||
    textValue(extracted.customerName) ||
    textValue(extracted.insuredName) ||
    textValue(extracted.name)
  const address =
    textValue(detectedCustomer?.address) ||
    textValue(extracted.projectAddress) ||
    textValue(extracted.propertyAddress) ||
    textValue(extracted.address)
  const lineItems = Array.isArray(extracted.lineItems) ? extracted.lineItems.length : 0
  const total = extracted.totalAmount ?? extracted.claimInfo?.rcv ?? extracted.claimInfo?.total

  if (category.includes('estimate') || category.includes('scope') || lineItems > 0 || total) {
    return {
      content: `Saved and analyzed ${filename}. It looks like an estimate/scope${customerName ? ` for ${customerName}` : ''}${address ? ` at ${address}` : ''}${lineItems ? ` with ${lineItems} extracted line item${lineItems === 1 ? '' : 's'}` : ''}${confidence !== null ? ` (${confidence}% confidence)` : ''}. I won’t attach or create records silently. Say “attach this to ${customerName || 'the customer'}”, “create a project from this document”, or “show the scope breakdown.”`,
      contextType: 'upload_link_prompt',
      contextData: { documentIds: documentId ? [documentId] : [], filenames: [filename], detectedCustomer: customerName ? { name: customerName, address } : null, suggestedActions: ['link_document_to_customer', 'create_project_from_document', 'get_scope_breakdown'] },
    }
  }

  if (category.includes('photo') || String(doc.mimeType || '').startsWith('image/')) {
    const photoType = textValue(extracted.photoType)
    const detectedDocumentType = textValue(extracted.likelyDocumentType)
    if (detectedDocumentType && detectedDocumentType !== 'other' && detectedDocumentType !== 'null') {
      return {
        content: `Saved and analyzed ${filename}. This photo looks like a document photo (${detectedDocumentType}). I need your approval before attaching it to a customer/project or treating it as a scope/estimate.`,
        contextType: 'upload_link_prompt',
        contextData: { documentIds: documentId ? [documentId] : [], filenames: [filename], detectedDocumentType },
      }
    }
    return {
      content: `Saved and analyzed ${filename}${photoType ? ` as ${photoType.replace(/_/g, ' ')}` : ''}. I did not find enough customer/job info in the image to attach it automatically. Tell me the customer/project or photo section, and I’ll link it.`,
      contextType: 'upload_link_prompt',
      contextData: { documentIds: documentId ? [documentId] : [], filenames: [filename], fileTypes: ['photo'], photoType },
    }
  }

  if (!linked) {
    return {
      content: `Saved and analyzed ${filename}. I could not confidently determine the customer/project from the file alone, so I left it unassigned. Tell me which customer or project it belongs to and I’ll attach it.`,
      contextType: 'upload_link_prompt',
      contextData: { documentIds: documentId ? [documentId] : [], filenames: [filename] },
    }
  }

  return null
}
