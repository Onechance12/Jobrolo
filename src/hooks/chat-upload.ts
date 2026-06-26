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

async function uploadOneFile(file: File, fields: Record<string, string>, signal?: AbortSignal) {
  const attempts = [0, 900, 1800]
  let lastError: unknown
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    if (attempt > 0) await wait(attempts[attempt])
    if (signal?.aborted) throw new DOMException('Upload stopped', 'AbortError')

    try {
      const form = new FormData()
      form.append('files', file)
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
  let suggestedPrompt: string | undefined
  let uploadContext: Record<string, unknown> | undefined

  for (const file of files) {
    try {
      const data = await uploadOneFile(file, opts.fields ?? {}, opts.signal)
      const docs = (data.documents || []) as UploadedDocument[]
      documents.push(...docs)
      if (data.needsLink) {
        needsLink = true
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

  return { documents, failures, needsLink, suggestedPrompt, uploadContext }
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
