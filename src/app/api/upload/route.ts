import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { saveUpload, thumbnailUrl } from '@/lib/upload'
import { requireContext } from '@/lib/security/context'
import { requireCustomer, requireProject, requireWorkspace } from '@/lib/security/ownership'
import { MAX_FILES_PER_UPLOAD, validateUpload, safeFilename } from '@/lib/security/upload-validation'
import { enqueueAgentJob, kickAgentJob } from '@/lib/jobs/queue'
import { toFileUrl } from '@/lib/file-url'
import { resolveFieldEntity } from '@/lib/field-copilot'
import { classifyUploadForSkills } from '@/lib/skills/context'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'
export const maxDuration = 60

const MULTIPART_MAX_BYTES = MAX_FILES_PER_UPLOAD * 25 * 1024 * 1024

function fileTypeFor(name: string, mimeType: string): string {
  return classifyUploadForSkills({ filename: name, mimeType }).fileType
}

function statusFor(fileType: string) {
  if (fileType === 'company_logo' || fileType === 'user_avatar') return 'reviewed'
  return fileType === 'photo' ? 'queued' : 'queued'
}

function storageKeyPrefix(input: { contractorId: string; documentId: string; projectId?: string; customerId?: string }) {
  const base = `contractors/${input.contractorId}`
  if (input.projectId) return `${base}/projects/${input.projectId}/documents/${input.documentId}`
  if (input.customerId) return `${base}/customers/${input.customerId}/documents/${input.documentId}`
  return `${base}/documents/${input.documentId}`
}

function isCompanyLevelUpload(uploadPurpose: string) {
  return ['company_logo', 'company_pricing', 'company_document', 'company_profile', 'company_template', 'template_library', 'user_avatar'].includes(uploadPurpose)
}

function isSimpleProfileAsset(fileType: string) {
  return fileType === 'company_logo' || fileType === 'user_avatar'
}

function numberField(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function uploadCaptureLocation(form: FormData) {
  const latitude = numberField(form.get('captureLatitude'))
  const longitude = numberField(form.get('captureLongitude'))
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  const accuracyMeters = numberField(form.get('captureAccuracyMeters'))
  const source = String(form.get('captureSource') || 'browser_gps').trim() || 'browser_gps'
  const capturedAt = String(form.get('capturedAt') || '').trim()
  return {
    latitude,
    longitude,
    accuracyMeters,
    source,
    capturedAt: capturedAt || new Date().toISOString(),
  }
}

export async function POST(req: NextRequest) {
  const requestId = uuidv4().slice(0, 8)
  console.log(`[upload] received requestId=${requestId} contentLength=${req.headers.get('content-length') || 'unknown'}`)
  try {
    const ctx = await requireContext(req).catch(e => e)
    if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
    if (!ctx.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const contentLength = Number(req.headers.get('content-length') || '0')
    if (contentLength && contentLength > MULTIPART_MAX_BYTES) {
      return NextResponse.json({ error: `Upload too large. Maximum ${MAX_FILES_PER_UPLOAD} files, 25MB each.` }, { status: 413 })
    }

    let form: FormData
    try {
      form = await req.formData()
    } catch (err) {
      console.error(`[upload] formData parse failed requestId=${requestId} contentType=${req.headers.get('content-type') || 'missing'} contentLength=${req.headers.get('content-length') || 'unknown'}:`, err)
      return NextResponse.json({
        error: 'Upload request was not received as valid multipart form data. Please try one smaller file/photo again.',
        code: 'UPLOAD_FORMDATA_PARSE_FAILED',
      }, { status: 400 })
    }
    const files = form.getAll('files').filter((value): value is File => value instanceof File)
    if (files.length === 0) return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })
    if (files.length > MAX_FILES_PER_UPLOAD) return NextResponse.json({ error: `Maximum ${MAX_FILES_PER_UPLOAD} files per upload` }, { status: 400 })
    console.log(`[upload] parsed requestId=${requestId} files=${files.length} totalBytes=${files.reduce((sum, f) => sum + f.size, 0)}`)

    const workspaceIdRaw = String(form.get('workspaceId') || '').trim()
    const projectIdRaw = String(form.get('projectId') || '').trim()
    const customerIdRaw = String(form.get('customerId') || '').trim()
    const uploadPurpose = String(form.get('uploadPurpose') || '').trim()
    const suggestedUploadPurpose = String(form.get('suggestedUploadPurpose') || '').trim()
    const uploadIntentSource = String(form.get('uploadIntentSource') || '').trim()
    const requireUploadConfirmation = String(form.get('requireUploadConfirmation') || '').trim() === 'true'
    const photoSection = String(form.get('photoSection') || '').trim()
    const photoSectionLabel = String(form.get('photoSectionLabel') || '').trim()
    const captureLocation = uploadCaptureLocation(form)

    let workspaceId: string | undefined
    let projectId: string | undefined
    let customerId: string | undefined

    const companyLevelUpload = isCompanyLevelUpload(uploadPurpose) || isCompanyLevelUpload(suggestedUploadPurpose)

    if (!companyLevelUpload && workspaceIdRaw) {
      const workspace = await requireWorkspace(ctx, workspaceIdRaw)
      if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      workspaceId = workspace.id
      projectId = workspace.projectId ?? undefined
      customerId = workspace.customerId ?? undefined
    }
    if (!companyLevelUpload && projectIdRaw) {
      const project = await requireProject(ctx, projectIdRaw)
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      projectId = project.id
      customerId = customerId ?? project.customerId ?? undefined
    }
    if (!companyLevelUpload && customerIdRaw) {
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
      avatarUrl?: string | null
      companyLogoUrl?: string | null
      locationResolution?: unknown
      storageScope?: string
      skillRoute?: string
      skillIds?: string[]
    }> = []

    for (const file of files) {
      const originalName = safeFilename(file.name || 'upload')
      const data = await file.arrayBuffer()
      const validation = validateUpload({ name: originalName, type: file.type || 'application/octet-stream', size: file.size, data })
      if (!validation.ok) return NextResponse.json({ error: validation.error || `Invalid file: ${originalName}` }, { status: 400 })

      const mimeType = validation.detectedMime || file.type || 'application/octet-stream'
      const documentId = uuidv4()
      const classification = classifyUploadForSkills({
        filename: originalName,
        mimeType,
        uploadPurpose,
        suggestedUploadPurpose,
        uploadIntentSource,
        photoSection,
        photoSectionLabel,
        hasCustomerContext: Boolean(customerId),
        hasProjectContext: Boolean(projectId),
        hasWorkspaceContext: Boolean(workspaceId),
      })
      const detectedFileType = fileTypeFor(originalName, mimeType)
      const fileType = uploadPurpose === 'company_logo'
        ? 'company_logo'
        : uploadPurpose === 'user_avatar'
          ? 'user_avatar'
          : uploadPurpose === 'company_pricing'
            ? 'price_sheet'
            : classification.fileType || detectedFileType
      const shouldStoreAsCompanyPricing = classification.storageScope === 'company_pricing' || fileType === 'price_sheet'
      const shouldStoreAsCompanyLevel = classification.companyLevel || shouldStoreAsCompanyPricing || isSimpleProfileAsset(fileType)
      const documentWorkspaceId = shouldStoreAsCompanyLevel ? undefined : workspaceId
      const documentProjectId = shouldStoreAsCompanyLevel ? undefined : projectId
      const documentCustomerId = shouldStoreAsCompanyLevel ? undefined : customerId
      const saved = await saveUpload({
        name: originalName,
        type: mimeType,
        size: file.size,
        data,
        storageKeyPrefix: storageKeyPrefix({ contractorId: ctx.contractorId, documentId, projectId: documentProjectId, customerId: documentCustomerId }),
      })
      const uploadContext = uploadPurpose || suggestedUploadPurpose || uploadIntentSource || photoSection || photoSectionLabel || shouldStoreAsCompanyPricing || classification.companyLevel || classification.needsClarification
        ? {
            uploadContext: {
              uploadPurpose: uploadPurpose || (shouldStoreAsCompanyPricing ? 'company_pricing' : null),
              suggestedUploadPurpose: suggestedUploadPurpose || null,
              uploadIntentSource: uploadIntentSource || null,
              requireUploadConfirmation,
              photoSection: photoSection || null,
              photoSectionLabel: photoSectionLabel || null,
              captureLocation,
              capturedFrom: 'chat_input',
              companyPricingDefault: shouldStoreAsCompanyPricing,
              skillIds: classification.skillIds,
              skillStorageScope: classification.storageScope,
              skillRoute: classification.route,
              skillConfidence: classification.confidence,
              documentType: classification.documentType,
              classificationReason: classification.reason,
            },
          }
        : captureLocation
          ? {
              uploadContext: {
                captureLocation,
                capturedFrom: 'chat_input',
                skillIds: classification.skillIds,
                skillStorageScope: classification.storageScope,
                skillRoute: classification.route,
                skillConfidence: classification.confidence,
                documentType: classification.documentType,
                classificationReason: classification.reason,
              },
            }
        : null
      const document = await db.document.create({
        data: {
          id: documentId,
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
          aiSummary: fileType === 'company_logo'
            ? 'Company logo uploaded for profile documents.'
            : fileType === 'user_avatar'
              ? 'User profile photo uploaded.'
              : undefined,
          extractedData: uploadContext ? JSON.stringify(uploadContext) : undefined,
          workspaceId: documentWorkspaceId,
          projectId: documentProjectId,
          customerId: documentCustomerId,
        },
      })
      console.log(`[upload] saved document requestId=${requestId} id=${document.id} file=${originalName} size=${document.size} type=${document.fileType}`)

      let appliedAvatarUrl: string | null = null
      if (uploadPurpose === 'user_avatar') {
        appliedAvatarUrl = thumbnailUrl(saved) || toFileUrl(document.filePath)
        await db.user.update({
          where: { id: ctx.user.id },
          data: { avatar: appliedAvatarUrl },
        })
        console.log(`[upload] updated user avatar requestId=${requestId} userId=${ctx.user.id} documentId=${document.id}`)
      }

      let appliedCompanyLogoUrl: string | null = null
      if (uploadPurpose === 'company_logo') {
        appliedCompanyLogoUrl = toFileUrl(document.filePath)
        await db.contractorProfile.upsert({
          where: { contractorId: ctx.contractorId },
          update: {
            logoUrl: appliedCompanyLogoUrl,
            logoDocumentId: document.id,
          },
          create: {
            contractorId: ctx.contractorId,
            companyName: ctx.contractor.company ?? ctx.contractor.name,
            displayName: ctx.contractor.company ?? ctx.contractor.name,
            logoUrl: appliedCompanyLogoUrl,
            logoDocumentId: document.id,
            country: 'US',
            brandPrimaryColor: '#2563EB',
            brandAccentColor: '#06B6D4',
            brandMode: 'dark',
            reportDisclaimer: 'This roof report documents visible conditions observed at the time of inspection. It is not a determination of insurance coverage, carrier liability, code compliance, or claim approval. Hidden damage, latent defects, and conditions not visible during inspection may exist.',
            legalFooter: 'Review all agreement language before use. Final terms are subject to the contractor\'s approved documents and applicable law.',
          },
        })
        console.log(`[upload] updated company logo requestId=${requestId} contractorId=${ctx.contractorId} documentId=${document.id}`)
      }

      let locationResolution: unknown = undefined
      if (!companyLevelUpload && !shouldStoreAsCompanyLevel && captureLocation) {
        try {
          locationResolution = await resolveFieldEntity(ctx, {
            documentId: document.id,
            projectId: documentProjectId,
            customerId: documentCustomerId,
            currentLocation: {
              latitude: captureLocation.latitude,
              longitude: captureLocation.longitude,
              accuracyMeters: captureLocation.accuracyMeters,
              source: captureLocation.source,
            },
            mode: uploadPurpose === 'inspection_photo' ? 'inspection_photo_upload' : 'upload_location',
            uploadedAt: captureLocation.capturedAt,
          })
          console.log(`[upload] location resolved requestId=${requestId} documentId=${document.id}`)
        } catch (err) {
          console.warn(`[upload] location resolution skipped requestId=${requestId} documentId=${document.id}:`, err)
        }
      }

      if (isSimpleProfileAsset(fileType)) {
        console.log(`[upload] skipped analysis requestId=${requestId} documentId=${document.id} type=${fileType}`)
      } else {
        try {
          const analysisJob = await enqueueAgentJob({
            contractorId: ctx.contractorId,
            userId: ctx.user.id,
            type: 'doc_analysis',
            input: { documentId: document.id, heicConversionNeeded: saved.needsConversion },
            workspaceId: documentWorkspaceId,
            priority: 4,
          })
          kickAgentJob(analysisJob.id, `upload:${requestId}`)
          console.log(`[upload] queued analysis requestId=${requestId} documentId=${document.id} jobId=${analysisJob.id}`)
        } catch (err) {
          console.error('[upload] queue analysis failed:', err)
        }
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
        ...(appliedAvatarUrl ? { avatarUrl: appliedAvatarUrl } : {}),
        ...(appliedCompanyLogoUrl ? { companyLogoUrl: appliedCompanyLogoUrl } : {}),
        ...(locationResolution ? { locationResolution } : {}),
        storageScope: classification.storageScope,
        skillRoute: classification.route,
        skillIds: classification.skillIds,
      })
    }

    const companyPricingUpload = !companyLevelUpload && documents.length > 0 && documents.every(d => d.fileType === 'price_sheet')
    const companyTemplateUpload = !companyLevelUpload && documents.length > 0 && documents.every(d => d.storageScope === 'company_template')
    const companyAssetUpload = !companyLevelUpload && documents.length > 0 && documents.every(d => ['brand_asset', 'user_profile', 'company_profile'].includes(d.storageScope || ''))
    const needsLink = !companyLevelUpload && !companyPricingUpload && !companyTemplateUpload && !companyAssetUpload && !customerId && !projectId && !workspaceId
    return NextResponse.json({
      documents,
      ...(companyPricingUpload ? {
        needsLink: false,
        deferLinkPrompt: true,
        suggestedPrompt: documents.length === 1
          ? 'Saved this as a company price sheet. I’ll extract the rows for review before importing anything into material pricing.'
          : `Saved ${documents.length} company price sheets. I’ll extract the rows for review before importing anything into material pricing.`,
        uploadContext: {
          documentIds: documents.map(d => d.id),
          filenames: documents.map(d => d.originalName),
          fileTypes: documents.map(d => d.fileType),
          uploadPurpose: 'company_pricing',
        },
      } : companyTemplateUpload ? {
        needsLink: false,
        deferLinkPrompt: true,
        suggestedPrompt: documents.length === 1
          ? 'Saved this as a company template candidate. Do you want me to turn it into a reusable Jobrolo template?'
          : `Saved ${documents.length} company template candidates. Tell me which ones should become reusable Jobrolo templates.`,
        uploadContext: {
          documentIds: documents.map(d => d.id),
          filenames: documents.map(d => d.originalName),
          fileTypes: documents.map(d => d.fileType),
          uploadPurpose: 'company_template',
        },
      } : companyAssetUpload ? {
        needsLink: false,
        deferLinkPrompt: true,
        suggestedPrompt: documents.some(d => d.fileType === 'company_logo')
          ? 'Saved this as a company logo candidate. Do you want me to update the company profile logo with it?'
          : documents.some(d => d.fileType === 'user_avatar')
            ? 'Saved this as a profile photo candidate. Do you want me to update your account avatar with it?'
            : 'Saved this as a company/profile asset. I’ll keep it out of customer files unless you ask me to attach it.',
        uploadContext: {
          documentIds: documents.map(d => d.id),
          filenames: documents.map(d => d.originalName),
          fileTypes: documents.map(d => d.fileType),
          uploadPurpose: documents.find(d => d.fileType === 'company_logo') ? 'company_logo_candidate' : 'profile_asset_candidate',
        },
      } : {}),
      ...(companyLevelUpload ? {
        needsLink: false,
        deferLinkPrompt: true,
        suggestedPrompt: requireUploadConfirmation && suggestedUploadPurpose === 'user_avatar'
          ? 'Saved this as a profile photo candidate. Do you want me to update your account avatar with it?'
          : requireUploadConfirmation && suggestedUploadPurpose === 'company_logo'
            ? 'Saved this as a company logo candidate. Do you want me to update the company profile logo with it?'
            : uploadPurpose === 'user_avatar'
          ? 'Saved your profile photo and updated your account avatar.'
          : uploadPurpose === 'company_logo'
            ? 'Saved your company logo and updated the company profile.'
            : 'Saved the company-level upload. I’ll keep it out of customer files unless you ask me to attach it.',
        uploadContext: {
          documentIds: documents.map(d => d.id),
          filenames: documents.map(d => d.originalName),
          fileTypes: documents.map(d => d.fileType),
          uploadPurpose,
          suggestedUploadPurpose,
          uploadIntentSource,
          requireUploadConfirmation,
          avatarUrl: documents.find(d => (d as any).avatarUrl)?.avatarUrl,
        },
      } : needsLink ? {
        needsLink: true,
        deferLinkPrompt: true,
        suggestedPrompt: documents.length === 1
          ? 'Saved the upload. I’ll review the saved analysis and ask before attaching it to a customer, project, pricing, or review queue.'
          : `Saved ${documents.length} uploads. I’ll review the saved analysis and ask before attaching them anywhere.`,
        uploadContext: {
          documentIds: documents.map(d => d.id),
          filenames: documents.map(d => d.originalName),
          fileTypes: documents.map(d => d.fileType),
        },
      } : {}),
    })
  } catch (err) {
    console.error(`[upload] failed requestId=${requestId}:`, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 })
  }
}
