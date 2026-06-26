// =============================================================================
// Document Worker v3 — Collaborative Multi-Pass Extraction Pipeline
// =============================================================================
// For every uploaded document, run multiple extraction passes in parallel
// where possible, then cross-check and reconcile:
//
//   PASS 1: Embedded text extraction (PDF text layer / TXT / DOCX / CSV)
//           → stored in Document.embeddedText
//
//   PASS 2: Vision/OCR extraction (always attempted when provider configured)
//           → stored in Document.visionText
//           → for image files (JPG/PNG/HEIC), this is the PRIMARY pass
//
//   PASS 3: AI structured analysis on the MERGED text
//           → stored in Document.extractedData + aiSummary + aiCategory
//
//   PASS 4: Cross-check comparison
//           → run entity extraction on embedded + vision separately
//           → detect conflicts (claim #, carrier, RCV, etc.)
//           → detect missing key fields
//           → compute confidence score (0-100)
//           → generate human review notes
//           → stored in Document.extractionComparison, conflictFlags,
//             missingDataFlags, extractionConfidence
//
//   PASS 5: Final reconciliation
//           → merge embedded + vision text into Document.ocrText (with markers)
//           → determine final extractionMethod
//           → mark status: reviewed / needs_ocr (only if BOTH passes failed)
//
// If no OCR provider is configured:
//   - PASS 2 is skipped
//   - Confidence is lowered
//   - Warning added: "OCR provider not configured, visual text may be missed"
//   - Pipeline continues — does NOT crash
// =============================================================================

import { readStoredFile } from '@/lib/storage'
import { db } from '@/lib/db'
import { analyzeDocument, enrichWithScopeIntelligence } from '@/lib/document-ai'
import { extractPdfText } from '@/lib/pdf'
import { convertHeicInBackground } from '@/lib/upload'
import { toFileUrl } from '@/lib/file-url'
import { completeJob, failJob, heartbeat } from '@/lib/jobs/queue'
import { scoreExtraction } from '@/lib/document/extraction-quality'
import { getOcrProvider, getOcrUnavailableReason } from '@/lib/document/ocr-provider'
import { compareExtractions, type ComparisonResult } from '@/lib/document/extraction-comparison'
import { createProjectTimelineEvent } from '@/lib/project-context'
import { getConfiguredProviderName } from '@/lib/ai'
import { resolveJobExecutionContext } from '@/lib/security/agent-execution'
import { createRoleNotification } from '@/lib/notifications'

interface AgentJobRow {
  id: string
  contractorId: string
  type: string
  inputJson: string
  workspaceId: string | null
  chatId: string | null
  userId: string | null
}

interface DocAnalysisInput {
  documentId: string
  heicConversionNeeded?: boolean
}

const MAX_TEXT_LENGTH = 200_000

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text
  const headLen = Math.floor(MAX_TEXT_LENGTH * 0.7)
  const tailLen = MAX_TEXT_LENGTH - headLen - 50
  return text.slice(0, headLen) + '\n\n[...truncated for length...]\n\n' + text.slice(-tailLen)
}

function parseDocumentData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function preservedUploadContext(current: { extractedData?: string | null }) {
  const existing = parseDocumentData(current.extractedData)
  return existing.uploadContext ? { uploadContext: existing.uploadContext } : {}
}

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasValue)
  return value !== null && value !== undefined && String(value).trim().length > 0
}

function buildDocumentReviewProfile(input: {
  documentId: string
  category?: string | null
  fileType?: string | null
  extractedData: Record<string, any>
  materialItemCount?: number
  lineItemCount?: number
  comparisonMissingData: Record<string, unknown>
}) {
  const category = String(input.category || '').toLowerCase()
  const fileType = String(input.fileType || '').toLowerCase()
  const lower = `${fileType} ${category}`.trim() || 'unknown'
  const documentType =
    lower.includes('price') ? 'price_sheet' :
    lower.includes('scope') ? 'scope_of_loss' :
    lower.includes('estimate') ? 'carrier_estimate' :
    lower.includes('claim') ? 'insurance_claim_doc' :
    lower.includes('contract') ? 'contract' :
    lower.includes('invoice') ? 'invoice' :
    lower.includes('photo') || lower.includes('image') ? 'photo' :
    'unknown'

  const data = input.extractedData ?? {}
  let expectedFields: string[] = []
  let missingFields: string[] = []
  let missingDataFlags: Record<string, boolean> = {}

  if (documentType === 'price_sheet') {
    expectedFields = ['supplier name', 'effective date', 'item name', 'category', 'SKU/code', 'unit', 'unit price', 'market/region', 'expiration date', 'notes/terms']
    const supplier = data.supplier ?? data.supplierName
    const effectiveDate = data.validDate ?? data.effectiveDate ?? data.validFrom
    const rows = Array.isArray(data.materialItems) ? data.materialItems : []
    const hasRows = input.materialItemCount ? input.materialItemCount > 0 : rows.length > 0
    const rowHas = (field: string, alt?: string) => rows.some((row: any) => hasValue(row?.[field]) || (alt ? hasValue(row?.[alt]) : false))
    missingDataFlags = {
      supplierName: !hasValue(supplier),
      effectiveDate: !hasValue(effectiveDate),
      itemName: !hasRows,
      category: hasRows && !rowHas('category'),
      skuOrCode: hasRows && !rowHas('sku', 'code'),
      unit: hasRows && !rowHas('unit'),
      unitPrice: hasRows && !rowHas('unitCost', 'unitPrice'),
      marketOrRegion: !hasValue(data.market) && !hasValue(data.region),
      expirationDate: !hasValue(data.validUntil) && !hasValue(data.expirationDate),
      notesOrTerms: !hasValue(data.notes) && !hasValue(data.terms),
    }
  } else if (documentType === 'scope_of_loss') {
    expectedFields = ['customer if visible', 'property address if visible', 'scope summary', 'line items', 'quantities', 'unit prices', 'totals/RCV']
    const claimInfo = data.claimInfo ?? {}
    const rows = Array.isArray(data.lineItems) ? data.lineItems : []
    const rowHas = (field: string) => rows.some((row: any) => hasValue(row?.[field]))
    missingDataFlags = {
      scopeSummary: !hasValue(data.scope) && !hasValue(data.summary) && !hasValue(data.aiSummary),
      lineItems: rows.length === 0 && !input.lineItemCount,
      quantities: rows.length > 0 && !rowHas('quantity'),
      unitPrices: rows.length > 0 && !rowHas('unitPrice'),
      totals: rows.length > 0 && !rowHas('total') && !rowHas('rcv') && !hasValue(data.totalAmount) && !hasValue(claimInfo.rcv),
    }
  } else if (documentType === 'carrier_estimate' || documentType === 'insurance_claim_doc') {
    expectedFields = ['insured/customer', 'property address', 'carrier', 'claim number', 'date of loss', 'deductible', 'RCV/total', 'ACV if present', 'depreciation if present', 'trade/category', 'line items', 'quantities', 'unit prices', 'totals']
    const claimInfo = data.claimInfo ?? {}
    const rows = Array.isArray(data.lineItems) ? data.lineItems : []
    const rowHas = (field: string) => rows.some((row: any) => hasValue(row?.[field]))
    missingDataFlags = {
      insuredOrCustomer: !hasValue(data.customer?.name) && !hasValue(data.customerName) && !hasValue(data.insuredName),
      propertyAddress: !hasValue(data.projectAddress) && !hasValue(data.propertyAddress) && !hasValue(data.customer?.address),
      carrier: !hasValue(claimInfo.carrier) && !hasValue(data.carrier),
      claimNumber: !hasValue(claimInfo.claimNumber) && !hasValue(data.claimNumber),
      dateOfLoss: !hasValue(claimInfo.dateOfLoss) && !hasValue(data.dateOfLoss),
      deductible: !hasValue(claimInfo.deductible) && !hasValue(data.deductible),
      rcv: !hasValue(claimInfo.rcv) && !hasValue(data.totalAmount) && !rowHas('rcv'),
      acv: false,
      depreciation: false,
      tradeOrCategory: rows.length > 0 && !rowHas('trade') && !rowHas('category'),
      lineItems: rows.length === 0 && !input.lineItemCount,
      quantities: rows.length > 0 && !rowHas('quantity'),
      unitPrices: rows.length > 0 && !rowHas('unitPrice'),
      totals: rows.length > 0 && !rowHas('total') && !rowHas('rcv'),
    }
  } else if (documentType === 'photo') {
    expectedFields = ['photo type', 'summary', 'visible damage/condition', 'materials visible', 'safety concerns', 'linked customer/project']
    const photoType = data.photoType ?? data.category
    const damageObserved = data.damageObserved ?? data.damage ?? data.observations
    missingDataFlags = {
      photoType: !hasValue(photoType),
      summary: !hasValue(data.summary) && !hasValue(data.description),
      damageObserved: !hasValue(damageObserved),
      materialsVisible: !hasValue(data.materialsVisible),
      safetyConcerns: false,
    }
  } else {
    expectedFields = ['document type', 'visible text', 'summary', 'linked customer/project']
    missingDataFlags = input.comparisonMissingData as Record<string, boolean>
  }

  missingFields = Object.entries(missingDataFlags).filter(([, missing]) => Boolean(missing)).map(([field]) => field)
  console.log(`[document-review] type detected documentId=${input.documentId} type=${documentType}`)
  console.log(`[document-review] validation profile applied documentId=${input.documentId} type=${documentType}`)
  console.log(`[document-review] missing fields by document type documentId=${input.documentId} type=${documentType} missing=${missingFields.join(',') || 'none'}`)
  return {
    documentType,
    expectedFields,
    missingFields,
    missingDataFlags,
    warnings: documentType === 'price_sheet'
      ? ['Price sheet review does not require insurance claim fields. Import requires explicit approval.']
      : documentType === 'photo'
        ? ['Photo review does not require insurance claim fields. Attach the photo to a customer/project before using it in a job packet or roof report.']
        : [],
  }
}

export async function processDocumentJob(job: AgentJobRow) {
  await resolveJobExecutionContext(job)
  const input = JSON.parse(job.inputJson) as DocAnalysisInput
  const { documentId, heicConversionNeeded } = input

  const doc = await db.document.findFirst({ where: { id: documentId, contractorId: job.contractorId } })
  if (!doc) {
    await failJob(job.id, `Document ${documentId} not found for contractor ${job.contractorId}`)
    return
  }

  console.log(`[doc-worker] job=${job.id} doc=${documentId} file=${doc.originalName} | stage: queued → processing`)
  await heartbeat(job.id, `Processing ${doc.originalName}`)
  await db.document.update({ where: { id: documentId }, data: { status: 'processing' } })

  try {
    // ----- HEIC conversion (if needed) -----
    if (heicConversionNeeded) {
      console.log(`[doc-worker] doc=${documentId} | stage: processing → heic_converting`)
      await heartbeat(job.id, `Converting HEIC: ${doc.originalName}`)
      const converted = await convertHeicInBackground(doc.filePath)
      if (!converted) {
        console.error(`[doc-worker] doc=${documentId} | HEIC conversion failed`)
        await db.document.update({
          where: { id: documentId },
          data: { status: 'failed', aiSummary: 'HEIC conversion failed.', extractionMethod: 'image_vision' },
        })
        await failJob(job.id, 'HEIC conversion failed')
        return
      }
      await db.document.update({
        where: { id: documentId },
        data: {
          filename: converted.newFilename,
          filePath: converted.newFilePath,
          thumbnailPath: converted.thumbnailPath,
          mimeType: 'image/jpeg',
        },
      })
      console.log(`[doc-worker] doc=${documentId} | HEIC converted → ${converted.newFilename}`)
    }

    const current = await db.document.findFirst({ where: { id: documentId, contractorId: job.contractorId } })
    if (!current) {
      await failJob(job.id, 'Document disappeared during processing')
      return
    }

    // ----- Route by file type -----
    const isImage = current.mimeType.startsWith('image/')
    if (isImage) {
      await processImageDocument(job, current)
    } else {
      await processTextDocument(job, current)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[doc-worker] doc=${documentId} | stage: * → failed:`, err)
    await db.document.update({
      where: { id: documentId },
      data: { status: 'failed', aiSummary: `Analysis failed: ${msg.slice(0, 300)}` },
    }).catch(() => {})
    await failJob(job.id, msg)
  }
}

// ---------------------------------------------------------------------------
// Image processing — vision + OCR provider (if configured) + AI comparison
// ---------------------------------------------------------------------------

async function processImageDocument(job: AgentJobRow, current: any) {
  const documentId = current.id
  console.log(`[doc-worker] doc=${documentId} | stage: processing → image pipeline`)
  await heartbeat(job.id, `Analyzing image: ${current.originalName}`)

  // PASS 1: Vision analysis via configured AI provider (OpenAI-compatible in production)
  const configuredAiProvider = getConfiguredProviderName()
  console.log(`[doc-worker] doc=${documentId} | PASS 1: vision analysis (configured provider: ${configuredAiProvider})`)
  console.log(`[ai-provider] using ${configuredAiProvider} for image analysis`)
  const analysis = await analyzeDocument({
    filePath: current.filePath,
    mimeType: current.mimeType,
    fileType: current.fileType,
    originalName: current.originalName,
    publicUrl: toFileUrl(current.filePath) || "",
    contractorId: job.contractorId,
    userId: job.userId,
    customerId: current.customerId,
    projectId: current.projectId,
    documentId,
  })

  // For images, "visionText" is the raw/visible text from the vision model's structured response
  const providerVisionText = (analysis.extractedData?.rawText as string) ?? (analysis.extractedData?.visibleText as string) ?? analysis.summary ?? ''
  const embeddedText = '' // images have no embedded text layer

  // PASS 2: OCR via configured provider (APILayer, etc.) — runs when provider is available
  let ocrProviderText = ''
  let ocrProviderName: string | null = null
  const warnings: string[] = []
  const provider = getOcrProvider()
  ocrProviderName = provider.name
  const ocrConfigured = provider.isAvailable()

  if (ocrConfigured) {
    console.log(`[doc-worker] doc=${documentId} | PASS 2: OCR provider '${provider.name}' extractFromImage()`)
    await heartbeat(job.id, `OCR extraction: ${current.originalName}`)
    try {
      const ocrResult = await provider.extractFromImage(current.filePath)
      if (ocrResult && ocrResult.text.trim().length > 0) {
        ocrProviderText = ocrResult.text
        console.log(`[doc-worker] doc=${documentId} | PASS 2: OCR extracted ${ocrProviderText.length} chars`)
      } else {
        console.log(`[doc-worker] doc=${documentId} | PASS 2: OCR returned no useful text`)
      }
    } catch (err) {
      console.error(`[doc-worker] doc=${documentId} | PASS 2: OCR provider failed:`, err)
      warnings.push(`OCR provider '${provider.name}' failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    console.log(`[doc-worker] doc=${documentId} | PASS 2: skipped — OCR provider not configured`)
    warnings.push('⚠️ OCR provider not configured, visual text may be missed. Set OCR_PROVIDER env var to enable OCR extraction.')
  }

  // Merge vision texts — configured provider vision is primary, OCR provider supplements
  let visionText = providerVisionText
  if (ocrProviderText.trim().length > 50) {
    if (providerVisionText.trim().length > 50) {
      visionText = `--- CONFIGURED VISION TEXT ---\n${providerVisionText}\n\n--- OCR PROVIDER TEXT (${ocrProviderName}) ---\n${ocrProviderText}`
    } else {
      visionText = ocrProviderText
    }
  }

  // PASS 4: Cross-check comparison
  const comparisonResult: ComparisonResult = compareExtractions({
    embeddedText,
    visionText,
    aiExtractedData: analysis.extractedData,
    ocrProviderConfigured: ocrConfigured,
    warnings,
  })

  // Build final extractedData. Keep this mutable so additive scope intelligence
  // can enrich image-based estimates without overwriting deterministic analysis.
  let fullData: Record<string, unknown> = {
    ...analysis.extractedData,
    ...preservedUploadContext(current),
    extractionMethod: 'image_vision',
    extractionConfidence: comparisonResult.confidence,
    conflicts: comparisonResult.conflicts,
    missingData: comparisonResult.missingData,
    reviewNotes: comparisonResult.reviewNotes,
    warnings: comparisonResult.warnings,
    ocrProvider: ocrProviderName,
    ocrProviderTextLength: ocrProviderText.length,
    providerVisionTextLength: providerVisionText.length,
    ...(analysis.lineItems?.length ? { lineItems: analysis.lineItems } : {}),
    ...(analysis.claimInfo ? { claimInfo: analysis.claimInfo } : {}),
    ...(analysis.materialItems?.length ? { materialItems: analysis.materialItems } : {}),
  }

  if (analysis?.category === 'price_sheet' && analysis?.materialItems?.length) {
    fullData.priceSheetReview = {
      status: 'pending_review',
      extractedRowCount: analysis.materialItems.length,
      importRequired: true,
      message: `Found ${analysis.materialItems.length} material rows. Review/import confirmation is required before changing the material database.`,
    }
    console.log(`[price-sheet] extracted rows pending review documentId=${documentId} count=${analysis.materialItems.length}`)
    console.log(`[price-sheet] auto-import skipped pending user confirmation documentId=${documentId}`)
  }

  const imageReview = buildDocumentReviewProfile({
    documentId,
    category: analysis.category,
    fileType: current.fileType,
    extractedData: fullData as Record<string, any>,
    materialItemCount: analysis.materialItems?.length ?? 0,
    lineItemCount: analysis.lineItems?.length ?? 0,
    comparisonMissingData: comparisonResult.missingData as Record<string, unknown>,
  })
  fullData.documentReview = imageReview

  // PASS 6: Additive scope intelligence with real document + contractor IDs.
  // For images, the merged OCR/vision text is `visionText`. Failure is
  // non-blocking; base parsing/processing remains intact.
  if ((analysis?.category === 'estimate' || analysis?.category === 'scope_of_loss' || analysis?.lineItems?.length) && visionText.trim().length > 0) {
    const enriched = await enrichWithScopeIntelligence({
      rawText: visionText,
      documentId,
      contractorId: job.contractorId,
      extractedData: fullData,
    })
    fullData = enriched.extractedData
    if (enriched.scopeIntelligence) {
      console.log(`[doc-worker] doc=${documentId} | scope intelligence ✓ (${enriched.scopeIntelligence.supplementReview.opportunities.length} supplement opportunities)`)
    }
  }

  const imageStatus = comparisonResult.confidence < 50 ? 'needs_review' : 'reviewed'
  if (imageStatus === 'needs_review') console.log(`[doc-worker] doc=${documentId} | low confidence — flagged for review`)

  await db.document.update({
    where: { id: documentId },
    data: {
      aiSummary: analysis.summary,
      aiCategory: analysis.category,
      extractedData: JSON.stringify(fullData),
      status: imageStatus,
      extractionMethod: 'image_vision',
      embeddedText: embeddedText || null,
      visionText: visionText ? truncateText(visionText) : null,
      ocrText: visionText ? truncateText(visionText) : null,
      extractionComparison: JSON.stringify(comparisonResult.comparison),
      extractionConfidence: comparisonResult.confidence,
      missingDataFlags: JSON.stringify(imageReview.missingDataFlags),
      conflictFlags: JSON.stringify(comparisonResult.conflicts),
      fileType: analysis.category !== 'document_analysis' && analysis.category !== 'unknown' ? analysis.category : current.fileType,
    },
  })

  await recordDocumentProcessingTimeline({
    contractorId: job.contractorId,
    projectId: current.projectId,
    customerId: current.customerId,
    documentId,
    originalName: current.originalName,
    status: imageStatus === 'needs_review' ? 'reviewed' : imageStatus,
    confidence: comparisonResult.confidence,
    conflictCount: Object.values(comparisonResult.conflicts).filter(Boolean).length,
    missingCount: Object.values(comparisonResult.missingData).filter(Boolean).length,
    extractionMethod: 'image_vision',
    source: 'system',
  })

  console.log(`[doc-worker] doc=${documentId} | image analysis complete`)
  if (imageStatus === 'needs_review') console.log(`[doc-worker] doc=${documentId} | needs review`)
  console.log(`[doc-worker] doc=${documentId} | stage: image pipeline → ${imageStatus} ✓ (confidence: ${comparisonResult.confidence}/100, OCR provider: ${ocrProviderName})`)

  if (analysis.detectedCustomer?.name) {
    try {
      await queueCustomerDocumentReview(documentId, job.contractorId, analysis.detectedCustomer, current)
    } catch (err) { console.error(`[doc-worker] customer/document review queue failed:`, err) }
  }

  await completeJob(job.id, {
    documentId,
    status: 'reviewed',
    category: analysis.category,
    summary: analysis.summary,
    extractionMethod: 'image_vision',
    confidence: comparisonResult.confidence,
    conflicts: Object.values(comparisonResult.conflicts).filter(Boolean).length,
    missingFields: Object.values(comparisonResult.missingData).filter(Boolean).length,
  })
}

// ---------------------------------------------------------------------------
// Text-based documents — collaborative multi-pass extraction
// ---------------------------------------------------------------------------

async function processTextDocument(job: AgentJobRow, current: any) {
  const documentId = current.id
  const isPdf = current.mimeType === 'application/pdf' || current.fileType === 'pdf'
  const isPlainText = current.mimeType.startsWith('text/') || ['text/plain', 'text/csv', 'application/json'].includes(current.mimeType)
  const isDocx = current.mimeType.includes('wordprocessingml') || current.originalName.toLowerCase().endsWith('.docx')

  // ============================================================
  // PASS 1: Embedded text extraction
  // ============================================================
  console.log(`[doc-worker] doc=${documentId} | PASS 1: embedded text extraction`)
  await heartbeat(job.id, `Extracting embedded text: ${current.originalName}`)

  let embeddedText = ''
  let pageCount = 0
  let primaryMethod: string

  if (isPdf) {
    const pdfResult = await extractPdfText(current.filePath)
    embeddedText = pdfResult.text ?? ''
    pageCount = pdfResult.pageCount
    primaryMethod = 'pdf_text'
  } else if (isPlainText) {
    try {
      embeddedText = (await readStoredFile(current.filePath)).toString('utf-8')
      pageCount = 1
      primaryMethod = current.mimeType === 'text/csv' || current.originalName.toLowerCase().endsWith('.csv')
        ? 'csv_text'
        : 'text_direct'
      console.log(`[doc-worker] doc=${documentId} | PASS 1: read ${embeddedText.length} chars as text file (method=${primaryMethod})`)
    } catch (err) {
      console.error(`[doc-worker] doc=${documentId} | PASS 1: text file read failed:`, err)
      embeddedText = ''
      primaryMethod = 'text_direct'
    }
  } else if (isDocx) {
    try {
      const mammoth = await import('mammoth')
      const buffer = await readStoredFile(current.filePath)
      const result = await mammoth.extractRawText({ buffer })
      embeddedText = result.value
      pageCount = 1
      primaryMethod = 'docx_text'
      console.log(`[doc-worker] doc=${documentId} | PASS 1: mammoth extracted ${embeddedText.length} chars from DOCX`)
    } catch (err) {
      console.error(`[doc-worker] doc=${documentId} | PASS 1: docx extraction failed:`, err)
      embeddedText = ''
      primaryMethod = 'docx_text'
    }
  } else {
    // Last-resort: try PDF extraction
    try {
      const pdfResult = await extractPdfText(current.filePath)
      embeddedText = pdfResult.text ?? ''
      pageCount = pdfResult.pageCount
      primaryMethod = 'pdf_text'
    } catch {
      embeddedText = ''
      primaryMethod = 'pdf_text'
    }
  }

  const embeddedQuality = scoreExtraction(embeddedText)
  console.log(`[doc-worker] doc=${documentId} | PASS 1: extracted ${embeddedText.length} chars (quality: ${embeddedQuality.score}/100)`)

  // ============================================================
  // PASS 2: Vision/OCR extraction (always attempted if provider configured)
  // ============================================================
  let visionText = ''
  let visionMethod = ''
  let ocrProviderName: string | null = null
  let ocrFailureReason: string | null = null
  const warnings: string[] = []

  const provider = getOcrProvider()
  ocrProviderName = provider.name
  const ocrConfigured = provider.isAvailable()

  if (!ocrConfigured) {
    warnings.push('⚠️ OCR provider not configured, visual text may be missed. Set OCR_PROVIDER env var to enable vision extraction.')
    console.log(`[doc-worker] doc=${documentId} | PASS 2: skipped — OCR provider not configured`)
  } else if (isPdf) {
    // For PDFs, ask the provider to extract text from the whole PDF
    console.log(`[doc-worker] doc=${documentId} | PASS 2: OCR provider '${provider.name}' extracting from PDF...`)
    await heartbeat(job.id, `OCR extraction: ${current.originalName}`)
    try {
      const ocrResult = await provider.extractFromPdf(current.filePath)
      if (ocrResult && ocrResult.text.trim().length > 0) {
        visionText = ocrResult.text
        visionMethod = 'pdf_ocr'
        console.log(`[doc-worker] doc=${documentId} | PASS 2: OCR extracted ${visionText.length} chars`)
      } else {
        console.log(`[doc-worker] doc=${documentId} | PASS 2: OCR returned no useful text`)
        ocrFailureReason = `OCR provider '${provider.name}' returned no useful text.`
      }
    } catch (err) {
      console.error(`[doc-worker] doc=${documentId} | PASS 2: OCR provider '${provider.name}' failed:`, err)
      ocrFailureReason = `OCR provider '${provider.name}' failed: ${err instanceof Error ? err.message : String(err)}`
      warnings.push(`OCR provider '${provider.name}' failed: ${ocrFailureReason}`)
    }
  }
  // For text files / DOCX, there's no visual text to OCR — skip PASS 2 entirely
  // (These formats have perfect embedded text by definition)

  // ============================================================
  // PASS 3: Merge text + AI structured analysis
  // ============================================================

  // Build merged text — prefer embedded for accuracy, supplement with vision
  let mergedText = ''
  let finalExtractionMethod = primaryMethod

  if (embeddedText.trim().length > 50 && visionText.trim().length > 50) {
    // Both available — combine with markers
    mergedText = `--- EMBEDDED TEXT ---\n${embeddedText}\n\n--- OCR/VISION TEXT ---\n${visionText}`
    finalExtractionMethod = isPdf ? 'pdf_hybrid' : primaryMethod
    console.log(`[doc-worker] doc=${documentId} | PASS 3: hybrid merge — ${embeddedText.length} embedded + ${visionText.length} vision chars`)
  } else if (embeddedText.trim().length > 50) {
    mergedText = embeddedText
    console.log(`[doc-worker] doc=${documentId} | PASS 3: using embedded text only`)
  } else if (visionText.trim().length > 50) {
    mergedText = visionText
    finalExtractionMethod = 'pdf_ocr'
    console.log(`[doc-worker] doc=${documentId} | PASS 3: using OCR/vision text only`)
  } else {
    // Both failed
    mergedText = ''
    console.log(`[doc-worker] doc=${documentId} | PASS 3: no text from any source`)
  }

  // Run AI analysis on merged text (or empty if both failed)
  console.log(`[doc-worker] doc=${documentId} | PASS 3: AI structured analysis`)
  await heartbeat(job.id, `Analyzing: ${current.originalName}`)

  let analysis: Awaited<ReturnType<typeof analyzeDocument>> | null = null
  if (mergedText.trim().length > 30) {
    analysis = await analyzeDocument({
      filePath: current.filePath,
      mimeType: current.mimeType,
      fileType: current.fileType,
      originalName: current.originalName,
      publicUrl: toFileUrl(current.filePath) || "",
      preExtractedText: mergedText,
      contractorId: job.contractorId,
      userId: job.userId,
      customerId: current.customerId,
      projectId: current.projectId,
      documentId,
    })
  }

  // ============================================================
  // PASS 4: Cross-check comparison
  // ============================================================
  console.log(`[doc-worker] doc=${documentId} | PASS 4: cross-check comparison`)

  const comparisonResult: ComparisonResult = compareExtractions({
    embeddedText,
    visionText,
    aiExtractedData: analysis?.extractedData ?? null,
    ocrProviderConfigured: ocrConfigured,
    warnings,
  })

  const conflictCount = Object.values(comparisonResult.conflicts).filter(Boolean).length
  const missingCount = Object.values(comparisonResult.missingData).filter(Boolean).length
  console.log(`[doc-worker] doc=${documentId} | PASS 4: confidence=${comparisonResult.confidence}/100, ${conflictCount} conflicts, ${missingCount} missing fields`)

  // ============================================================
  // PASS 5: Final reconciliation — persist everything
  // ============================================================

  // If both extractions completely failed → needs_ocr
  if (mergedText.trim().length < 50) {
    console.log(`[doc-worker] doc=${documentId} | stage: * → needs_ocr (no text from any source)`)
    let reason: string
    if (!isPdf) {
      reason = 'Document uploaded but no extractable text found. The file format may require manual conversion.'
    } else if (ocrProviderName === 'none' || !ocrConfigured) {
      reason = `PDF uploaded (${pageCount} pages). No embedded text found. ${getOcrUnavailableReason()}`
    } else if (ocrFailureReason) {
      reason = `PDF uploaded (${pageCount} pages). Embedded text extraction failed and OCR provider '${ocrProviderName}' could not extract text. ${ocrFailureReason}`
    } else {
      reason = `PDF uploaded (${pageCount} pages). No extractable text found via any method.`
    }

    await db.document.update({
      where: { id: documentId },
      data: {
        status: 'needs_ocr',
        aiSummary: reason,
        aiCategory: 'scanned_pdf',
        extractionMethod: finalExtractionMethod || primaryMethod,
        embeddedText: embeddedText ? truncateText(embeddedText) : null,
        visionText: visionText ? truncateText(visionText) : null,
        ocrText: null,
        extractionComparison: JSON.stringify(comparisonResult.comparison),
        extractionConfidence: comparisonResult.confidence,
        missingDataFlags: JSON.stringify(comparisonResult.missingData),
        conflictFlags: JSON.stringify(comparisonResult.conflicts),
        extractedData: JSON.stringify({
          ...preservedUploadContext(current),
          pageCount,
          textLength: mergedText.length,
          ocrAttempted: ocrConfigured,
          ocrProvider: ocrProviderName,
          ocrFailureReason,
          ocrRequired: true,
          mimeType: current.mimeType,
          reviewNotes: comparisonResult.reviewNotes,
          warnings: comparisonResult.warnings,
        }),
      },
    })
    await recordDocumentProcessingTimeline({
      contractorId: job.contractorId,
      projectId: current.projectId,
      customerId: current.customerId,
      documentId,
      originalName: current.originalName,
      status: 'needs_ocr',
      confidence: comparisonResult.confidence,
      conflictCount,
      missingCount,
      extractionMethod: finalExtractionMethod || primaryMethod,
      source: 'system',
      message: reason,
    })

    await completeJob(job.id, {
      documentId,
      status: 'needs_ocr',
      pageCount,
      textLength: mergedText.length,
      extractionMethod: finalExtractionMethod || primaryMethod,
      ocrProvider: ocrProviderName,
      confidence: comparisonResult.confidence,
      message: reason,
    })
    return
  }

  // Successful extraction — persist full result
  let finalData: Record<string, unknown> = {
    ...(analysis?.extractedData ?? {}),
    ...preservedUploadContext(current),
    pageCount,
    textLength: mergedText.length,
    embeddedTextLength: embeddedText.length,
    visionTextLength: visionText.length,
    extractionMethod: finalExtractionMethod,
    extractionConfidence: comparisonResult.confidence,
    conflicts: comparisonResult.conflicts,
    missingData: comparisonResult.missingData,
    reviewNotes: comparisonResult.reviewNotes,
    warnings: comparisonResult.warnings,
    ...(analysis?.lineItems?.length ? { lineItems: analysis.lineItems } : {}),
    ...(analysis?.claimInfo ? { claimInfo: analysis.claimInfo } : {}),
    ...(analysis?.materialItems?.length ? { materialItems: analysis.materialItems } : {}),
  }

  if (analysis?.category === 'price_sheet' && analysis?.materialItems?.length) {
    finalData.priceSheetReview = {
      status: 'pending_review',
      extractedRowCount: analysis.materialItems.length,
      importRequired: true,
      message: `Found ${analysis.materialItems.length} material rows. Review/import confirmation is required before changing the material database.`,
    }
    console.log(`[price-sheet] extracted rows pending review documentId=${documentId} count=${analysis.materialItems.length}`)
    console.log(`[price-sheet] auto-import skipped pending user confirmation documentId=${documentId}`)
  }

  const documentReview = buildDocumentReviewProfile({
    documentId,
    category: analysis?.category,
    fileType: current.fileType,
    extractedData: finalData as Record<string, any>,
    materialItemCount: analysis?.materialItems?.length ?? 0,
    lineItemCount: analysis?.lineItems?.length ?? 0,
    comparisonMissingData: comparisonResult.missingData as Record<string, unknown>,
  })
  finalData.documentReview = documentReview

  // PASS 6: Additive scope intelligence with real document + contractor IDs.
  // Failure is non-blocking; base parsing/processing remains intact.
  if ((analysis?.category === 'estimate' || analysis?.category === 'scope_of_loss' || analysis?.lineItems?.length) && mergedText.trim().length > 0) {
    const enriched = await enrichWithScopeIntelligence({
      rawText: mergedText,
      documentId,
      contractorId: job.contractorId,
      extractedData: finalData,
    })
    finalData = enriched.extractedData
    if (enriched.scopeIntelligence) {
      console.log(`[doc-worker] doc=${documentId} | scope intelligence ✓ (${enriched.scopeIntelligence.supplementReview.opportunities.length} supplement opportunities)`)
    }
  }

  await db.document.update({
    where: { id: documentId },
    data: {
      aiSummary: analysis?.summary ?? 'Document processed.',
      aiCategory: analysis?.category ?? 'other',
      extractedData: JSON.stringify(finalData),
      status: 'reviewed',
      extractionMethod: finalExtractionMethod,
      embeddedText: embeddedText ? truncateText(embeddedText) : null,
      visionText: visionText ? truncateText(visionText) : null,
      ocrText: truncateText(mergedText),
      extractionComparison: JSON.stringify(comparisonResult.comparison),
      extractionConfidence: comparisonResult.confidence,
      missingDataFlags: JSON.stringify(documentReview.missingDataFlags),
      conflictFlags: JSON.stringify(comparisonResult.conflicts),
      fileType: analysis?.category && analysis.category !== 'document_analysis' && analysis.category !== 'unknown' && analysis.category !== 'scanned_pdf'
        ? analysis.category
        : current.fileType,
    },
  })

  await recordDocumentProcessingTimeline({
    contractorId: job.contractorId,
    projectId: current.projectId,
    customerId: current.customerId,
    documentId,
    originalName: current.originalName,
    status: 'reviewed',
    confidence: comparisonResult.confidence,
    conflictCount,
    missingCount,
    extractionMethod: finalExtractionMethod,
    source: 'system',
  })

  console.log(`[doc-worker] doc=${documentId} | stage: analyzed → reviewed ✓ (method=${finalExtractionMethod}, confidence=${comparisonResult.confidence}/100)`)

  // ----- Side effects: review routing only -----
  // Do NOT silently create/update/link customers from extracted document text.
  // Extraction can be wrong ("Dison" vs "Disen", different phone/address, etc.).
  // Route a review item instead so the operator explicitly decides how to attach it.
  if (analysis?.detectedCustomer?.name) {
    try {
      await queueCustomerDocumentReview(documentId, job.contractorId, analysis.detectedCustomer, current)
    } catch (err) {
      console.error(`[doc-worker] doc=${documentId} | customer/document review queue failed:`, err)
    }
  }

  // Price sheets are intentionally NOT auto-imported into MaterialItem.
  // They remain on Document.extractedData.materialItems until the user approves
  // import_price_sheet_items. This avoids silent data-changing imports.

  await completeJob(job.id, {
    documentId,
    status: 'reviewed',
    category: analysis?.category,
    summary: analysis?.summary,
    pageCount,
    textLength: mergedText.length,
    extractionMethod: finalExtractionMethod,
    confidence: comparisonResult.confidence,
    conflicts: conflictCount,
    missingFields: missingCount,
    reviewNotes: comparisonResult.reviewNotes.length,
  })
}

// ---------------------------------------------------------------------------
// Project timeline bridge for document OCR/review status
// ---------------------------------------------------------------------------

async function recordDocumentProcessingTimeline(input: {
  contractorId: string
  projectId?: string | null
  customerId?: string | null
  documentId: string
  originalName: string
  status: 'reviewed' | 'needs_ocr' | 'failed'
  confidence?: number | null
  conflictCount?: number
  missingCount?: number
  extractionMethod?: string | null
  source?: string
  message?: string | null
}) {
  if (!input.projectId) return
  const needsReview = input.status === 'needs_ocr' || (input.confidence !== null && input.confidence !== undefined && input.confidence < 85) || Boolean(input.conflictCount && input.conflictCount > 0)
  await createProjectTimelineEvent({
    contractorId: input.contractorId,
    projectId: input.projectId,
    customerId: input.customerId,
    eventType: needsReview ? 'document_review_needed' : 'document_analyzed',
    title: needsReview ? `Document needs review: ${input.originalName}` : `Document analyzed: ${input.originalName}`,
    body: input.message ?? `Extraction method: ${input.extractionMethod ?? 'unknown'}; confidence: ${input.confidence ?? 'n/a'}; conflicts: ${input.conflictCount ?? 0}; missing fields: ${input.missingCount ?? 0}`,
    relatedType: 'document',
    relatedId: input.documentId,
    source: input.source ?? 'system',
    metadata: {
      status: input.status,
      extractionMethod: input.extractionMethod,
      confidence: input.confidence,
      conflictCount: input.conflictCount ?? 0,
      missingCount: input.missingCount ?? 0,
    },
  }).catch(() => null)
}

// ---------------------------------------------------------------------------
// Customer/document review routing
// ---------------------------------------------------------------------------

async function queueCustomerDocumentReview(docId: string, contractorId: string, detected: { name?: string; email?: string | null; phone?: string | null; address?: string }, doc?: { originalName?: string | null; customerId?: string | null; projectId?: string | null }) {
  const name = detected.name?.trim()
  if (!name) return

  if (doc?.customerId || doc?.projectId) {
    console.log(`[doc-worker] doc=${docId} | customer/document review skipped — already linked`)
    return
  }

  const existing = await db.inboxItem.findFirst({
    where: {
      contractorId,
      type: 'document_link_review',
      relatedType: 'document',
      relatedId: docId,
      status: { in: ['unread', 'read'] },
    },
  })
  if (existing) return

  const candidates = await db.customer.findMany({
    where: {
      contractorId,
      OR: [
        { name: { contains: name } },
        ...(detected.phone ? [{ phone: { contains: detected.phone } }] : []),
        ...(detected.email ? [{ email: { contains: detected.email } }] : []),
        ...(detected.address ? [{ address: { contains: detected.address } }] : []),
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: { id: true, name: true, phone: true, email: true, address: true },
  })

  await createRoleNotification({
    contractorId,
    role: 'project_manager',
    type: 'document_link_review',
    title: `Review document owner: ${doc?.originalName ?? 'uploaded document'}`,
    summary: `Document analysis detected ${name}. Confirm before attaching or updating a customer file.`,
    priority: 'normal',
    relatedType: 'document',
    relatedId: docId,
    payload: {
      cardType: 'document_link_review',
      documentId: docId,
      documentName: doc?.originalName ?? null,
      detectedCustomer: detected,
      candidateCustomers: candidates,
      suggestedPrompts: [
        `Attach ${doc?.originalName ?? 'this document'} to ${name}`,
        `Create a project from document ${docId}`,
        `Leave document ${doc?.originalName ?? docId} unassigned`,
      ],
      message: 'Extraction suggested a customer, but Jobrolo did not silently change records. Use chat or the file card to attach/create/update after review.',
    },
  })
  console.log(`[doc-worker] doc=${docId} | queued customer/document review for detected customer: ${name}`)
}
