// =============================================================================
// Document AI — classification + structured extraction
// =============================================================================
// Pipeline (called by document worker):
//   1. detectDocumentType() — content-based classification
//   2. analyzeDocument() — route by type, run specialized parser + AI extraction
//   3. extractEntities() — regex-based deterministic extraction (always runs)
//   4. mergeEntities() — combine AI + regex results
// =============================================================================

import { readStoredFile } from '@/lib/storage'
import { analyzeImage } from './ai'
import { extractPdfText, truncateForAI } from './pdf'
import { chatComplete } from './ai'
import { parseAbcSupplyPriceList, parseXactimateLineItems } from './specialized-parsers'
import { parseScope } from './scope-parser'
import { extractEntities, mergeEntities, type ExtractedEntities } from './document/entity-extractor'
import { analyzeScopeIntelligence, serializeForStorage, type ScopeIntelligenceResult } from './scope-intelligence'

export interface DocumentAnalysis {
  summary: string
  category: string
  extractedData: Record<string, unknown>
  materialItems?: Array<{ name: string; sku?: string; category?: string; unit?: string; unitCost: number; manufacturer?: string; productLine?: string; alternateUnit?: string; alternateUnitPrice?: number }>
  lineItems?: Array<{ code?: string; description: string; quantity: number | null; unit: string | null; unitPrice: number | null; total: number | null }>
  claimInfo?: { claimNumber?: string; policyNumber?: string; dateOfLoss?: string; adjuster?: string; insured?: string; property?: string; total?: number; carrier?: string; deductible?: number; rcv?: number; acv?: number; depreciation?: number; mortgageCompany?: string; adjusterPhone?: string; adjusterEmail?: string }
  detectedCustomer?: { name?: string; email?: string | null; phone?: string | null; address?: string }
  /** AI-enhanced scope intelligence (additive, non-destructive). May be undefined if analysis failed. */
  scopeIntelligence?: ScopeIntelligenceResult
}

// Expanded category set
export const DOCUMENT_CATEGORIES = [
  'estimate',
  'scope_of_loss',
  'carrier_letter',
  'inspection_report',
  'invoice',
  'receipt',
  'contract',
  'claim_document',
  'mortgage_document',
  'customer_document',
  'price_sheet',
  'insurance_claim',
  'photo',
  'other',
] as const

export function detectDocumentType(text: string, filename: string): string {
  const l = text.toLowerCase(), ln = filename.toLowerCase()

  // Filename-based detection (strong signal)
  if (ln.includes('price') || ln.includes('pricelist') || ln.includes('price list')) return 'price_sheet'
  if (ln.includes('scope')) return 'scope_of_loss'
  if (ln.includes('estimate') || ln.includes('resolution')) return 'estimate'
  if (ln.includes('contract') || ln.includes('agreement')) return 'contract'
  if (ln.includes('invoice') || ln.includes('billing')) return 'invoice'
  if (ln.includes('permit')) return 'permit' // legacy
  if (ln.includes('inspection')) return 'inspection_report'
  if (ln.includes('mortgage') || ln.includes('lienholder')) return 'mortgage_document'
  if (ln.includes('denial')) return 'carrier_letter'
  if (ln.includes('carrier') && ln.includes('letter')) return 'carrier_letter'

  // Content-based detection (insurance docs)
  if (l.includes('insured:') && l.includes('claim number:')) return 'estimate'
  if (l.includes('type of loss:') && l.includes('adjuster')) return 'estimate'
  if (l.includes('price list:') && l.includes('date of loss:')) return 'estimate'
  if (l.includes('xactimate') || l.includes('restoration/service/remodel')) return 'estimate'
  if (l.includes('scope of loss') || l.includes('less deductible')) return 'scope_of_loss'
  if (l.includes('insurance claim') || l.includes('policy number:')) return 'claim_document'

  // Carrier letters / denial letters
  if (l.includes('denial of claim') || l.includes('we regret to inform') || l.includes('coverage determination')) return 'carrier_letter'
  if (l.includes('dear ') && (l.includes('insured') || l.includes('policyholder')) && l.includes('sincerely')) return 'carrier_letter'

  // Inspection reports
  if (l.includes('inspection report') || (l.includes('inspector') && l.includes('findings'))) return 'inspection_report'
  if (l.includes('roof inspection') && l.includes('condition')) return 'inspection_report'

  // Mortgage documents
  if (l.includes('mortgage company') || l.includes('loan number') || l.includes('deed of trust')) return 'mortgage_document'

  // Invoice
  if (l.includes('invoice #') || l.includes('invoice number:') || l.includes('invoice date:')) return 'invoice'
  if (l.includes('amount due') && l.includes('remit to')) return 'invoice'

  // Contract
  if (l.includes('this agreement') || l.includes('work authorization') || l.includes('contractor and customer agree')) return 'contract'

  // Price sheets (supplier catalogs)
  if (l.includes('customer price list') || l.includes('bid proposal')) return 'price_sheet'
  if (l.includes('abc supply') && l.includes('unit price')) return 'price_sheet'
  if (l.includes('qxo') && l.includes('pricing')) return 'price_sheet'
  if (l.includes('new con pricing') || l.includes('bid number')) return 'price_sheet'
  if (l.includes('effective date:') && l.includes('unit price') && !l.includes('insured:')) return 'price_sheet'

  return 'other'
}

export async function analyzeDocument(opts: {
  filePath: string
  mimeType: string
  fileType: string
  originalName: string
  publicUrl: string
  preExtractedText?: string
}): Promise<DocumentAnalysis> {
  const { filePath, mimeType, originalName, publicUrl, preExtractedText } = opts
  let fileType = opts.fileType

  // Photos use vision analysis
  if (mimeType.startsWith('image/')) return await analyzePhoto(publicUrl, originalName)

  // Get text (use pre-extracted if provided)
  let text: string | null = null
  if (preExtractedText !== undefined) {
    text = preExtractedText
  } else if (mimeType === 'application/pdf' || fileType === 'pdf') {
    const r = await extractPdfText(filePath)
    text = r.text
  } else if (mimeType.startsWith('text/') || ['text/plain', 'text/csv', 'application/json'].includes(mimeType)) {
    try {
      text = (await readStoredFile(filePath)).toString('utf-8')
    } catch { text = null }
  } else if (mimeType.includes('wordprocessingml') || originalName.toLowerCase().endsWith('.docx')) {
    try {
      const mammoth = await import('mammoth')
      const buffer = await readStoredFile(filePath)
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } catch { text = null }
  }

  // Detect type from content
  if (text && text.length > 50) {
    const dt = detectDocumentType(text, originalName)
    if (dt !== fileType && dt !== 'other') {
      console.log(`[doc-ai] content detection: ${fileType} → ${dt}`)
      fileType = dt
    }
  }

  // Route by type
  let analysis: DocumentAnalysis
  if (fileType === 'price_sheet') {
    analysis = await analyzePriceSheet(text ?? '', originalName)
  } else if (fileType === 'scope_of_loss' || fileType === 'xactimate' || fileType === 'symbility' || fileType === 'insurance_claim' || fileType === 'estimate') {
    analysis = await analyzeEstimate(text ?? '', originalName)
  } else if (fileType === 'contract') {
    analysis = await analyzeGeneric(text ?? '', originalName, 'contract')
  } else if (fileType === 'carrier_letter') {
    analysis = await analyzeGeneric(text ?? '', originalName, 'carrier_letter')
  } else if (fileType === 'inspection_report') {
    analysis = await analyzeGeneric(text ?? '', originalName, 'inspection_report')
  } else if (fileType === 'invoice' || fileType === 'receipt') {
    analysis = await analyzeGeneric(text ?? '', originalName, 'invoice')
  } else if (fileType === 'mortgage_document') {
    analysis = await analyzeGeneric(text ?? '', originalName, 'mortgage_document')
  } else if (fileType === 'claim_document') {
    analysis = await analyzeEstimate(text ?? '', originalName)
  } else if (text && text.length > 50) {
    analysis = await analyzeGeneric(text, originalName)
  } else {
    return { summary: 'File uploaded — no extractable content found.', category: 'other', extractedData: {} }
  }

  // ----- Always run regex entity extraction as a base layer -----
  const regexEntities: ExtractedEntities = extractEntities(text ?? '')

  // Merge: regex wins for fields it caught, AI fills in the rest
  const merged = mergeEntities(analysis.extractedData, regexEntities)
  analysis.extractedData = merged

  // Promote claim info to top-level field
  if (merged.claimInfo && typeof merged.claimInfo === 'object') {
    const ci = merged.claimInfo as Record<string, unknown>
    analysis.claimInfo = {
      ...(analysis.claimInfo ?? {}),
      claimNumber: ci.claimNumber as string | undefined,
      policyNumber: ci.policyNumber as string | undefined,
      carrier: ci.carrier as string | undefined,
      insured: ci.insured as string | undefined,
      adjuster: ci.adjuster as string | undefined,
      adjusterPhone: ci.adjusterPhone as string | undefined,
      adjusterEmail: ci.adjusterEmail as string | undefined,
      dateOfLoss: ci.dateOfLoss as string | undefined,
      deductible: ci.deductible as number | undefined,
      rcv: ci.rcv as number | undefined,
      acv: ci.acv as number | undefined,
      depreciation: ci.depreciation as number | undefined,
      mortgageCompany: ci.mortgageCompany as string | undefined,
      property: (merged.project as any)?.address,
      total: ci.rcv as number | undefined,
    }
  }

  // Promote detected customer
  const customer = merged.customer as Record<string, unknown> | undefined
  if (customer?.name) {
    analysis.detectedCustomer = {
      name: String(customer.name),
      email: customer.email as string | null | undefined,
      phone: customer.phone as string | null | undefined,
      address: customer.address as string | undefined,
    }
  }

  return analysis
}

// ---------------------------------------------------------------------------
// Photo analysis — uses vision
// ---------------------------------------------------------------------------

async function analyzePhoto(imageUrl: string, originalName: string): Promise<DocumentAnalysis> {
  try {
    const r = await analyzeImage(imageUrl, `Analyze this photo for a roofing contractor. Respond as JSON: {"summary":"1-2 sentences","category":"photo","extractedData":{"location":"where","damageObserved":"any damage or none","materialsVisible":"materials or unknown","safetyConcerns":"any or none","photoType":"roof|attic|exterior|interior|damage|other"}}`)
    let c = r.trim(); if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    try {
      const p = JSON.parse(c)
      return {
        summary: p.summary || 'Photo analyzed.',
        category: 'photo',
        extractedData: p.extractedData || {},
      }
    } catch {
      return { summary: r.slice(0, 200) || 'Photo uploaded.', category: 'photo', extractedData: { rawResponse: r } }
    }
  } catch {
    return { summary: 'Photo uploaded.', category: 'photo', extractedData: {} }
  }
}

// ---------------------------------------------------------------------------
// Price sheet analysis (specialized parser + AI fallback)
// ---------------------------------------------------------------------------

async function analyzePriceSheet(text: string, originalName: string): Promise<DocumentAnalysis> {
  const abcItems = parseAbcSupplyPriceList(text)
  if (abcItems.length > 5) {
    console.log(`[doc-ai] ABC Supply parser: ${abcItems.length} items`)
    const supplier = text.match(/Customer:\s*\d+\s*-\s*(.+?)(?:\s|$)/)?.[1]?.trim() || 'ABC Supply'
    const effDate = text.match(/Effective Date:\s*([\d/]+)/)?.[1] || null
    return {
      summary: `Price sheet from ${supplier} with ${abcItems.length} material items (effective ${effDate || 'unknown'})`,
      category: 'price_sheet',
      extractedData: { supplier, validDate: effDate, categoryCounts: abcItems.reduce((a, i) => { a[i.category] = (a[i.category] || 0) + 1; return a }, {} as Record<string, number>) },
      materialItems: abcItems.map(i => ({ name: i.name, category: i.category, manufacturer: i.manufacturer, productLine: i.productLine, unit: i.unit, unitCost: i.unitPrice, alternateUnit: i.alternateUnit, alternateUnitPrice: i.alternateUnitPrice })),
    }
  }
  try {
    const r = await chatComplete([
      { role: 'system', content: `Extract material items from this price list. Respond as JSON (no markdown fences):\n{"summary":"1-2 sentences","category":"price_sheet","extractedData":{"supplier":"name or null","validDate":"date or null"},"materialItems":[{"name":"...","sku":"...","category":"Shingles|Underlayment|Decking|Flashing|Fasteners|Ventilation|Sealants|Other","unit":"SQ|ROLL|PCS|BOX|LF|BUNDLE|EA","unitCost":0.00}]}` },
      { role: 'user', content: `File: ${originalName}\n\n${truncateForAI(text, 8000)}` },
    ], { temperature: 0.1, maxTokens: 4000 })
    let c = r.trim(); if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    const p = JSON.parse(c)
    console.log(`[doc-ai] AI price sheet: ${p.materialItems?.length ?? 0} items`)
    return {
      summary: p.summary,
      category: 'price_sheet',
      extractedData: p.extractedData || {},
      materialItems: p.materialItems || [],
    }
  } catch (err) {
    console.error('[doc-ai] price sheet failed:', err)
    return { summary: `Price sheet uploaded (${text.length} chars).`, category: 'price_sheet', extractedData: { rawLength: text.length } }
  }
}

// ---------------------------------------------------------------------------
// Estimate / scope analysis (Xactimate parser + AI claim extraction)
// ---------------------------------------------------------------------------

async function analyzeEstimate(text: string, originalName: string): Promise<DocumentAnalysis> {
  try {
    const r = await chatComplete([
      { role: 'system', content: `Extract claim info from this insurance estimate. Respond as JSON only (no markdown fences).

IMPORTANT — entity ownership rules:
- "customer" / "customerEmail" / "customerPhone" = the HOMEOWNER (the insured person).
- "adjuster" / "adjusterEmail" / "adjusterPhone" = the INSURANCE ADJUSTER (a State Farm / Allstate / etc. employee).
- "carrier" = the INSURANCE COMPANY.
- NEVER copy the adjuster's email/phone into the customerEmail/customerPhone fields.
- If you can't find the homeowner's own email/phone, return null for those fields.

JSON shape:
{"customer":"homeowner name or null","customerEmail":"homeowner email or null","customerPhone":"homeowner phone or null","projectAddress":"address or null","totalAmount":"total as number or null","scope":"1-2 sentence summary","claimNumber":"claim # or null","policyNumber":"policy # or null","carrier":"insurance company or null","dateOfLoss":"date or null","adjuster":"adjuster name or null","adjusterPhone":"adjuster phone or null","adjusterEmail":"adjuster email or null","deductible":"number or null","rcv":"number or null","acv":"number or null","depreciation":"number or null","mortgageCompany":"string or null"}` },
      { role: 'user', content: `File: ${originalName}\n\n${truncateForAI(text, 8000)}` },
    ], { temperature: 0.1, maxTokens: 1000 })
    let c = r.trim(); if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    const ext = JSON.parse(c)

    // Xactimate / scope parser for line items
    const xactItems = parseXactimateLineItems(text)
    let lineItems: Array<{ code?: string; description: string; quantity: number | null; unit: string | null; unitPrice: number | null; total: number | null }> = []
    if (xactItems.length > 0) {
      lineItems = xactItems.map(li => ({ code: li.lineNumber, description: li.description, quantity: li.quantity, unit: li.unit, unitPrice: li.unitPrice, total: li.rcv }))
      console.log(`[doc-ai] Xactimate parser: ${lineItems.length} items`)
    } else {
      const parsed = parseScope(text)
      lineItems = parsed.lineItems.map(li => ({
        code: li.lineNumber,
        description: li.description,
        quantity: li.quantity ? Number(li.quantity) : null,
        unit: li.unit,
        unitPrice: li.unitPrice ? Number(li.unitPrice.replace(/[$,]/g, '')) : null,
        total: li.rcv ? Number(li.rcv.replace(/[$,]/g, '')) : null,
      }))
    }

    const total = ext.totalAmount ?? ext.rcv ?? (lineItems.length > 0 ? lineItems.reduce((s, li) => s + (li.total || 0), 0) : null)
    const analysisResult: DocumentAnalysis = {
      summary: ext.scope || `Estimate for ${ext.customer || 'unknown'}`,
      category: 'estimate',
      extractedData: {
        // P2: customer sub-object contains ONLY homeowner-owned fields.
        // Adjuster/carrier/contractor/mortgage contacts live in their own
        // sections below — never inside `customer`.
        customer: {
          name: ext.customer || undefined,
          email: ext.customerEmail || undefined,
          phone: ext.customerPhone || undefined,
          address: ext.projectAddress || undefined,
        },
        projectAddress: ext.projectAddress,
        estimateDate: ext.estimateDate || null,
        totalAmount: total,
        scope: ext.scope,
        lineItems,
        // P2: claimInfo contains adjuster + carrier + claim metadata.
        // These fields are NEVER copied into `customer.*` by downstream code.
        claimInfo: {
          claimNumber: ext.claimNumber,
          policyNumber: ext.policyNumber,
          carrier: ext.carrier,
          dateOfLoss: ext.dateOfLoss,
          adjuster: ext.adjuster,
          adjusterPhone: ext.adjusterPhone,
          adjusterEmail: ext.adjusterEmail,
          deductible: ext.deductible,
          rcv: ext.rcv,
          acv: ext.acv,
          depreciation: ext.depreciation,
          mortgageCompany: ext.mortgageCompany,
          property: ext.projectAddress,
          total: ext.rcv ?? total,
        },
      },
      lineItems,
      // P2 ENTITY FIX: detectedCustomer is the HOMEOWNER's contact info only.
      // NEVER use adjusterEmail/adjusterPhone here — those belong to the
      // adjuster entity, not the customer. The AI prompt asks for them
      // separately, so we keep them in claimInfo (where they belong) and
      // only include the homeowner's own email/phone in detectedCustomer.
      // If the AI didn't return a separate customerEmail/customerPhone field,
      // we leave email/phone NULL — the radar will then ask the operator to
      // capture the customer's real contact info directly.
      detectedCustomer: ext.customer ? {
        name: ext.customer,
        email: ext.customerEmail || null,    // NOT ext.adjusterEmail
        phone: ext.customerPhone || null,    // NOT ext.adjusterPhone
        address: ext.projectAddress,
      } : undefined,
    }


    return analysisResult
  } catch (err) {
    console.error('[doc-ai] estimate failed:', err)
    // Fallback: Xactimate parser only
    const xactItems = parseXactimateLineItems(text)
    if (xactItems.length > 0) {
      const lineItems = xactItems.map(li => ({ code: li.lineNumber, description: li.description, quantity: li.quantity, unit: li.unit, unitPrice: li.unitPrice, total: li.rcv }))
      const total = lineItems.reduce((s, li) => s + (li.total || 0), 0)
      return {
        summary: `Estimate with ${lineItems.length} items (RCV: $${total.toLocaleString()})`,
        category: 'estimate',
        extractedData: { totalAmount: total, lineItems },
        lineItems,
      }
    }
    return { summary: 'Estimate uploaded but analysis failed.', category: 'estimate', extractedData: {} }
  }
}

// ---------------------------------------------------------------------------
// Generic analysis (carrier letters, inspection reports, contracts, etc.)
// ---------------------------------------------------------------------------

async function analyzeGeneric(text: string, originalName: string, hint?: string): Promise<DocumentAnalysis> {
  try {
    const hintStr = hint ? ` Document type hint: ${hint}.` : ''
    const r = await chatComplete([
      {
        role: 'system',
        content: `Analyze this document. Respond as JSON (no markdown fences):${hintStr}\n{"summary":"1-2 sentences","category":"${hint || 'document_analysis'}","extractedData":{"documentType":"type","keyInfo":["facts"],"dates":["dates"],"amounts":["amounts"],"parties":["people/companies"],"letterDate":"date if letter","sender":"who wrote it","recipient":"who it's addressed to"}}`,
      },
      { role: 'user', content: `File: ${originalName}\n\n${truncateForAI(text, 6000)}` },
    ], { temperature: 0.2, maxTokens: 1500 })
    let c = r.trim(); if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    const p = JSON.parse(c)
    return {
      summary: p.summary,
      category: p.category || hint || 'document_analysis',
      extractedData: p.extractedData || {},
    }
  } catch {
    return { summary: `Document uploaded (${text.length} chars).`, category: hint || 'other', extractedData: { rawLength: text.length } }
  }
}


// ---------------------------------------------------------------------------
// Scope intelligence enrichment — called from document worker AFTER DB insert
// so real documentId and contractorId are available for audit/log context.
// This is additive: failure never breaks deterministic parsing.
// ---------------------------------------------------------------------------
export async function enrichWithScopeIntelligence(input: {
  rawText: string
  documentId: string
  contractorId: string
  extractedData: Record<string, unknown>
}): Promise<{ extractedData: Record<string, unknown>; scopeIntelligence?: ScopeIntelligenceResult }> {
  const extractedData = { ...input.extractedData }

  if (!input.rawText || input.rawText.trim().length < 20) {
    return {
      extractedData: {
        ...extractedData,
        scopeIntelligenceStatus: 'skipped',
        scopeIntelligenceError: 'No usable text available for scope intelligence.',
      },
    }
  }

  try {
    const intelligence = await analyzeScopeIntelligence({
      rawText: input.rawText,
      documentId: input.documentId,
      contractorId: input.contractorId,
      parserResult: parseScope(input.rawText),
    })

    if (!intelligence.available) {
      return {
        extractedData: {
          ...extractedData,
          scopeIntelligenceStatus: 'failed',
          scopeIntelligenceError: intelligence.error ?? 'Scope intelligence unavailable.',
        },
      }
    }

    return {
      extractedData: {
        ...extractedData,
        scopeIntelligenceStatus: 'success',
        scopeIntelligenceJson: serializeForStorage(intelligence),
      },
      scopeIntelligence: intelligence,
    }
  } catch (err) {
    console.error('[doc-ai] scope intelligence enrichment failed (non-blocking):', err)
    return {
      extractedData: {
        ...extractedData,
        scopeIntelligenceStatus: 'failed',
        scopeIntelligenceError: err instanceof Error ? err.message : 'AI analysis failed',
      },
    }
  }
}
