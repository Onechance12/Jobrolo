import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { saveUpload, thumbnailUrl } from '@/lib/upload'
import { requireContext } from '@/lib/security/context'
import { requireCustomer, requireProject, requireWorkspace } from '@/lib/security/ownership'
import { MAX_FILES_PER_UPLOAD, validateUpload, safeFilename } from '@/lib/security/upload-validation'
import { enqueueAgentJob } from '@/lib/jobs/queue'
import { toFileUrl } from '@/lib/file-url'

export const runtime = 'nodejs'
export const maxDuration = 60

const MULTIPART_MAX_BYTES = MAX_FILES_PER_UPLOAD * 25 * 1024 * 1024

function fileTypeFor(name: string, mimeType: string): string {
  const lower = name.toLowerCase()
  if (mimeType.startsWith('image/')) return 'photo'
  if (mimeType === 'application/pdf') {
    if (/estimate|xactimate|scope/.test(lower)) return lower.includes('scope') ? 'scope_of_loss' : 'estimate'
    if (/contract|agreement|authorization/.test(lower)) return 'contract'
    if (/invoice/.test(lower)) return 'invoice'
    if (/claim|insurance|carrier/.test(lower)) return 'insurance_claim'
    if (/permit/.test(lower)) return 'permit'
    if (/price|pricing|material/.test(lower)) return 'price_sheet'
    return 'pdf'
  }
  if (/estimate|xactimate/.test(lower)) return 'estimate'
  if (/scope/.test(lower)) return 'scope_of_loss'
  if (/price|pricing|material/.test(lower)) return 'price_sheet'
  if (/contract|agreement|authorization/.test(lower)) return 'contract'
  if (/invoice/.test(lower)) return 'invoice'
  if (/claim|insurance|carrier/.test(lower)) return 'insurance_claim'
  if (/permit/.test(lower)) return 'permit'
  return 'other'
}

function statusFor(fileType: string) {
  return fileType === 'photo' ? 'queued' : 'queued'
}

export async function POST(req: NextRequest) {
  console.log('[upload] received')
  try {
    const ctx = await requireContext(req).catch(e => e)
    if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
    if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const contentLength = Number(req.headers.get('content-length') || '0')
    if (contentLength && contentLength > MULTIPART_MAX_BYTES) {
      return NextResponse.json({ error: `Upload too large. Maximum ${MAX_FILES_PER_UPLOAD} files, 25MB each.` }, { status: 413 })
    }

    const form = await req.formData()
    const files = form.getAll('files').filter((value): value is File => value instanceof File)
    if (files.length === 0) return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })
    if (files.length > MAX_FILES_PER_UPLOAD) return NextResponse.json({ error: `Maximum ${MAX_FILES_PER_UPLOAD} files per upload` }, { status: 400 })

    const workspaceIdRaw = String(form.get('workspaceId') || '').trim()
    const projectIdRaw = String(form.get('projectId') || '').trim()
    const customerIdRaw = String(form.get('customerId') || '').trim()

    let workspaceId: string | undefined
    let projectId: string | undefined
    let customerId: string | undefined

    if (workspaceIdRaw) {
      const workspace = await requireWorkspace(ctx, workspaceIdRaw)
      if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      workspaceId = workspace.id
      projectId = workspace.projectId ?? undefined
      customerId = workspace.customerId ?? undefined
    }
    if (projectIdRaw) {
      const project = await requireProject(ctx, projectIdRaw)
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      projectId = project.id
      customerId = customerId ?? project.customerId ?? undefined
    }
    if (customerIdRaw) {
      const customer = await requireCustomer(ctx, customerIdRaw)
      if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      customerId = customer.id
    }

    const documents: Array<{
      id: string
      originalName: string
      fileType: string
      mimeType: string
      size: number
      status: string
      url: string | null
      thumbnailUrl: string | null
    }> = []

    for (const file of files) {
      const originalName = safeFilename(file.name || 'upload')
      const data = await file.arrayBuffer()
      const validation = validateUpload({ name: originalName, type: file.type || 'application/octet-stream', size: file.size, data })
      if (!validation.ok) return NextResponse.json({ error: validation.error || `Invalid file: ${originalName}` }, { status: 400 })

      const mimeType = validation.detectedMime || file.type || 'application/octet-stream'
      const saved = await saveUpload({ name: originalName, type: mimeType, size: file.size, data })
      const fileType = fileTypeFor(originalName, mimeType)
      const document = await db.document.create({
        data: {
          contractorId: ctx.contractorId,
          uploadedById: ctx.user.id,
          filename: saved.filename,
          originalName,
          mimeType: saved.mimeType,
          size: saved.size,
          filePath: saved.filePath,
          thumbnailPath: saved.thumbnailPath,
          fileType,
          status: statusFor(fileType),
          workspaceId,
          projectId,
          customerId,
        },
      })
      console.log(`[upload] saved document id=${document.id} file=${originalName}`)

      try {
        await enqueueAgentJob({
          contractorId: ctx.contractorId,
          userId: ctx.user.id,
          type: 'doc_analysis',
          input: { documentId: document.id, heicConversionNeeded: saved.needsConversion },
          workspaceId,
          priority: 4,
        })
        console.log(`[upload] queued analysis documentId=${document.id}`)
      } catch (err) {
        console.error('[upload] queue analysis failed:', err)
      }

      documents.push({
        id: document.id,
        originalName: document.originalName,
        fileType: document.fileType,
        mimeType: document.mimeType,
        size: document.size,
        status: document.status,
        url: toFileUrl(document.filePath),
        thumbnailUrl: thumbnailUrl(saved),
      })
    }

    const needsLink = !customerId && !projectId && !workspaceId
    return NextResponse.json({
      documents,
      ...(needsLink ? {
        needsLink: true,
        suggestedPrompt: 'Saved. Which customer or project should I attach this upload to?',
        uploadContext: {
          documentIds: documents.map(d => d.id),
          filenames: documents.map(d => d.originalName),
          fileTypes: documents.map(d => d.fileType),
        },
      } : {}),
    })
  } catch (err) {
    console.error('[upload] failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 })
  }
}
