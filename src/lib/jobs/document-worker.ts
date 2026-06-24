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
import { logActivity, ACTIVITY_TYPES } from '@/lib/activity'
import { toFileUrl } from '@/lib/file-url'
import { completeJob, failJob, heartbeat } from '@/lib/jobs/queue'
import { scoreExtraction } from '@/lib/document/extraction-quality'
import { getOcrProvider, getOcrUnavailableReason } from '@/lib/document/ocr-provider'
import { compareExtractions, type ComparisonResult } from '@/lib/document/extraction-comparison'
import { createProjectTimelineEvent } from '@/lib/project-context'

interface AgentJobRow {
  id: string
  contractorId: string
  type: string
  inputJson: string
  workspaceId: string | null
  chatId: string | null
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

export async function processDocumentJob(job: AgentJobRow) {
  const input = JSON.parse(job.inputJson) as DocAnalysisInput
  const { documentId, heicConversionNeeded } = input

  const doc = await db.document.findUnique({ where: { id: documentId } })
  if (!doc || doc.contractorId !== job.contractorId) {
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

    const current = await db.document.findUnique({ where: { id: documentId } })
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

  // PASS 1: Vision analysis via z-ai SDK (always runs — primary pass for images)
  console.log(`[doc-worker] doc=${documentId} | PASS 1: vision analysis (z-ai SDK)`)
  const analysis = await analyzeDocument({
    filePath: current.filePath,
    mimeType: current.mimeType,
    fileType: current.fileType,
    originalName: current.originalName,
    publicUrl: toFileUrl(current.filePath) || "",
  })

  // For images, "visionText" is the rawText from the vision model's structured response
  const zaiVisionText = (analysis.extractedData?.rawText as string) ?? analysis.summary ?? ''
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

  // Merge vision texts — z-ai vision is primary, OCR provider supplements
  let visionText = zaiVisionText
  if (ocrProviderText.trim().length > 50) {
    if (zaiVisionText.trim().length > 50) {
      visionText = `--- Z-AI VISION TEXT ---\n${zaiVisionText}\n\n--- OCR PROVIDER TEXT (${ocrProviderName}) ---\n${ocrProviderText}`
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
    extractionMethod: 'image_vision',
    extractionConfidence: comparisonResult.confidence,
    conflicts: comparisonResult.conflicts,
    missingData: comparisonResult.missingData,
    reviewNotes: comparisonResult.reviewNotes,
    warnings: comparisonResult.warnings,
    ocrProvider: ocrProviderName,
    ocrProviderTextLength: ocrProviderText.length,
    zaiVisionTextLength: zaiVisionText.length,
    ...(analysis.lineItems?.length ? { lineItems: analysis.lineItems } : {}),
    ...(analysis.claimInfo ? { claimInfo: analysis.claimInfo } : {}),
    ...(analysis.materialItems?.length ? { materialItems: analysis.materialItems } : {}),
  }

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

  await db.document.update({
    where: { id: documentId },
    data: {
      aiSummary: analysis.summary,
      aiCategory: analysis.category,
      extractedData: JSON.stringify(fullData),
      status: 'reviewed',
      extractionMethod: 'image_vision',
      embeddedText: embeddedText || null,
      visionText: visionText ? truncateText(visionText) : null,
      ocrText: visionText ? truncateText(visionText) : null,
      extractionComparison: JSON.stringify(comparisonResult.comparison),
      extractionConfidence: comparisonResult.confidence,
      missingDataFlags: JSON.stringify(comparisonResult.missingData),
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
    status: 'reviewed',
    confidence: comparisonResult.confidence,
    conflictCount: Object.values(comparisonResult.conflicts).filter(Boolean).length,
    missingCount: Object.values(comparisonResult.missingData).filter(Boolean).length,
    extractionMethod: 'image_vision',
    source: 'system',
  })

  console.log(`[doc-worker] doc=${documentId} | stage: image pipeline → reviewed ✓ (confidence: ${comparisonResult.confidence}/100, OCR provider: ${ocrProviderName})`)

  if (analysis.detectedCustomer?.name) {
    try {
      await autoLinkToCustomer(documentId, job.contractorId, analysis.detectedCustomer)
    } catch (err) { console.error(`[doc-worker] customer linking failed:`, err) }
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
      missingDataFlags: JSON.stringify(comparisonResult.missingData),
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

  // ----- Side effects: customer linking + material items -----
  if (analysis?.detectedCustomer?.name) {
    try {
      await autoLinkToCustomer(documentId, job.contractorId, analysis.detectedCustomer)
      console.log(`[doc-worker] doc=${documentId} | linked to customer: ${analysis.detectedCustomer.name}`)
    } catch (err) {
      console.error(`[doc-worker] doc=${documentId} | customer linking failed:`, err)
    }
  }

  if (analysis?.materialItems?.length) {
    // Check for existing items with same name + unit to avoid duplicates
    const existingItems = await db.materialItem.findMany({
      where: { contractorId: job.contractorId },
      select: { name: true, unit: true, unitCost: true },
    })
    const existingKeys = new Set(existingItems.map(i => `${i.name.toLowerCase()}|${i.unit}|${i.unitCost}`))

    let savedCount = 0
    for (const item of analysis.materialItems) {
      const key = `${item.name.toLowerCase()}|${item.unit || 'EA'}|${item.unitCost}`
      if (existingKeys.has(key)) continue  // skip duplicate
      existingKeys.add(key)
      await db.materialItem.create({
        data: {
          contractorId: job.contractorId,
          name: item.name,
          sku: item.sku || null,
          category: item.category || 'other',
          unit: item.unit || 'EA',
          unitCost: item.unitCost,
        },
      }).catch(() => {})
      savedCount++
    }
    console.log(`[doc-worker] doc=${documentId} | saved ${savedCount} new material items (${analysis.materialItems.length} total, ${analysis.materialItems.length - savedCount} duplicates skipped)`)
  }

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
// Customer auto-linking
// ---------------------------------------------------------------------------

async function autoLinkToCustomer(docId: string, contractorId: string, detected: { name?: string; email?: string | null; phone?: string | null; address?: string }) {
  const name = detected.name?.trim()
  if (!name) return
  const existing = (await db.customer.findMany({ where: { contractorId } })).find(c => c.name.toLowerCase() === name.toLowerCase())
  let customer
  if (existing) {
    customer = await db.customer.update({
      where: { id: existing.id },
      data: {
        email: detected.email ?? existing.email,
        phone: detected.phone ?? existing.phone,
        address: detected.address ?? existing.address,
      },
    })
  } else {
    customer = await db.customer.create({
      data: {
        contractorId,
        name,
        email: detected.email || null,
        phone: detected.phone || null,
        address: detected.address || null,
      },
    })
  }
  const project = await db.project.findFirst({
    where: { customerId: customer.id, contractorId, status: 'active' },
    include: { workspace: true },
  })
  await db.document.update({
    where: { id: docId },
    data: {
      customerId: customer.id,
      projectId: project?.id ?? null,
      workspaceId: project?.workspace?.id ?? null,
    },
  })
  if (project) {
    await logActivity(project.id, ACTIVITY_TYPES.DOCUMENT_ANALYZED, `Document analyzed: ${detected.name}`, {
      source: 'system', body: '', relatedId: docId, relatedType: 'document',
    }).catch(() => {})
  }
}
