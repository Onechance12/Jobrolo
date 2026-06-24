// =============================================================================
// Extraction Comparison Engine — collaborative multi-pass extraction comparison
// =============================================================================
// Compares extraction results from multiple methods (embedded text, vision/OCR,
// AI structured extraction) to detect:
//   - conflicts (same field, different values)
//   - missing data (key fields not found in any extraction)
//   - confidence score (0-100)
//   - recommended human review notes
//
// Used by the document worker after running all extraction passes.
// =============================================================================

import { extractEntities, type ExtractedEntities } from './entity-extractor'
import { scoreExtraction, type QualityScore } from './extraction-quality'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConflictFlags {
  claimNumberMismatch?: boolean     // different claim # in embedded vs vision
  carrierMismatch?: boolean
  customerMismatch?: boolean        // insured name differs
  addressMismatch?: boolean         // property/project address differs
  rcvMismatch?: boolean
  acvMismatch?: boolean
  deductibleMismatch?: boolean
  dateOfLossMismatch?: boolean
  adjusterMismatch?: boolean
  totalAmountMismatch?: boolean
}

export interface MissingDataFlags {
  claimNumber?: boolean
  policyNumber?: boolean
  carrier?: boolean
  insured?: boolean
  adjuster?: boolean
  adjusterContact?: boolean    // phone or email
  dateOfLoss?: boolean
  deductible?: boolean
  rcv?: boolean
  acv?: boolean
  depreciation?: boolean
  propertyAddress?: boolean
  lineItems?: boolean
  totals?: boolean
}

export interface ExtractionMethodResult {
  method: string               // pdf_text | vision_ocr | text_direct | docx_text | csv_text | image_vision
  available: boolean
  textLength: number
  qualityScore: number
  qualityReason: string
  keywordHits: string[]
  structureHits: string[]
  entities: ExtractedEntities
}

export interface ExtractionComparison {
  methods: ExtractionMethodResult[]
  // Per-method presence of key insurance fields
  fieldPresence: Record<string, Record<string, boolean>>  // field → method → present
  // Cross-method agreement (0-100): higher = more methods agree
  agreementScore: number
  // Pages/sections vision saw but embedded missed
  visionOnlyContent: boolean
  embeddedOnlyContent: boolean
  // Final merged text length
  mergedTextLength: number
}

export interface ComparisonResult {
  comparison: ExtractionComparison
  conflicts: ConflictFlags
  missingData: MissingDataFlags
  confidence: number            // 0-100
  confidenceReason: string
  reviewNotes: string[]         // actionable recommendations for human review
  warnings: string[]            // non-blocking warnings (e.g. "OCR provider not configured")
}

// ---------------------------------------------------------------------------
// Key insurance fields to track across methods
// ---------------------------------------------------------------------------

const KEY_FIELDS: Array<{ key: string; label: string; get: (e: ExtractedEntities) => string | number | undefined | null }> = [
  { key: 'claimNumber', label: 'Claim Number', get: e => e.claimInfo.claimNumber },
  { key: 'policyNumber', label: 'Policy Number', get: e => e.claimInfo.policyNumber },
  { key: 'carrier', label: 'Carrier', get: e => e.claimInfo.carrier },
  { key: 'insured', label: 'Insured', get: e => e.claimInfo.insured ?? e.customer.name },
  { key: 'adjuster', label: 'Adjuster', get: e => e.claimInfo.adjuster },
  { key: 'dateOfLoss', label: 'Date of Loss', get: e => e.claimInfo.dateOfLoss },
  { key: 'deductible', label: 'Deductible', get: e => e.claimInfo.deductible },
  { key: 'rcv', label: 'RCV', get: e => e.claimInfo.rcv },
  { key: 'acv', label: 'ACV', get: e => e.claimInfo.acv },
  { key: 'propertyAddress', label: 'Property Address', get: e => e.project.address ?? e.customer.address },
]

// ---------------------------------------------------------------------------
// Compare two values for "sameness" — case-insensitive, trimmed, numeric-tolerant
// ---------------------------------------------------------------------------

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  // Numeric comparison
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.01
  }
  // String comparison — normalize
  const sa = String(a).trim().toLowerCase().replace(/[\s.,\-()]+/g, ' ')
  const sb = String(b).trim().toLowerCase().replace(/[\s.,\-()]+/g, ' ')
  if (sa === sb) return true
  // One contains the other (e.g. "State Farm" vs "State Farm Insurance Company")
  if (sa.length > 3 && sb.length > 3 && (sa.includes(sb) || sb.includes(sa))) return true
  return false
}

// ---------------------------------------------------------------------------
// Build an ExtractionMethodResult from raw text
// ---------------------------------------------------------------------------

export function buildMethodResult(method: string, text: string | null | undefined): ExtractionMethodResult {
  const actualText = text ?? ''
  const quality = scoreExtraction(actualText)
  const entities = extractEntities(actualText)
  return {
    method,
    available: actualText.trim().length > 0,
    textLength: actualText.length,
    qualityScore: quality.score,
    qualityReason: quality.reason,
    keywordHits: quality.keywordHits,
    structureHits: quality.structureHits,
    entities,
  }
}

// ---------------------------------------------------------------------------
// Detect conflicts between two extraction results
// ---------------------------------------------------------------------------

function detectConflicts(methods: ExtractionMethodResult[]): ConflictFlags {
  const conflicts: ConflictFlags = {}
  // Get methods that actually have data
  const activeMethods = methods.filter(m => m.available)
  if (activeMethods.length < 2) return conflicts

  // Compare each pair of methods for each key field
  const fieldAccessors: Array<{ key: keyof ConflictFlags; field: string }> = [
    { key: 'claimNumberMismatch', field: 'claimNumber' },
    { key: 'carrierMismatch', field: 'carrier' },
    { key: 'customerMismatch', field: 'insured' },
    { key: 'addressMismatch', field: 'propertyAddress' },
    { key: 'rcvMismatch', field: 'rcv' },
    { key: 'acvMismatch', field: 'acv' },
    { key: 'deductibleMismatch', field: 'deductible' },
    { key: 'dateOfLossMismatch', field: 'dateOfLoss' },
    { key: 'adjusterMismatch', field: 'adjuster' },
  ]

  for (const { key, field } of fieldAccessors) {
    const accessor = KEY_FIELDS.find(f => f.key === field)
    if (!accessor) continue
    const values: Array<{ method: string; value: unknown }> = []
    for (const m of activeMethods) {
      const v = accessor.get(m.entities)
      if (v != null && v !== '') values.push({ method: m.method, value: v })
    }
    // If 2+ methods found a value AND they differ → conflict
    if (values.length >= 2) {
      const allEqual = values.every((v, _i, arr) => valuesEqual(v.value, arr[0].value))
      if (!allEqual) {
        (conflicts as any)[key] = true
      }
    }
  }

  return conflicts
}

// ---------------------------------------------------------------------------
// Detect missing key fields across all extractions
// ---------------------------------------------------------------------------

function detectMissingData(methods: ExtractionMethodResult[]): MissingDataFlags {
  const missing: MissingDataFlags = {}

  // Merge all entities — a field is "missing" only if no method found it
  const merged: ExtractedEntities = {
    claimInfo: {},
    customer: {},
    contractor: {},
    project: {},
    phones: [],
    emails: [],
    dates: [],
    dollarAmounts: [],
    unknownEmails: [],
    unknownPhones: [],
  }
  for (const m of methods) {
    if (m.entities.claimInfo.claimNumber && !merged.claimInfo.claimNumber) merged.claimInfo.claimNumber = m.entities.claimInfo.claimNumber
    if (m.entities.claimInfo.policyNumber && !merged.claimInfo.policyNumber) merged.claimInfo.policyNumber = m.entities.claimInfo.policyNumber
    if (m.entities.claimInfo.carrier && !merged.claimInfo.carrier) merged.claimInfo.carrier = m.entities.claimInfo.carrier
    if (m.entities.claimInfo.insured && !merged.claimInfo.insured) merged.claimInfo.insured = m.entities.claimInfo.insured
    if (m.entities.customer.name && !merged.customer.name) merged.customer.name = m.entities.customer.name
    if (m.entities.claimInfo.adjuster && !merged.claimInfo.adjuster) merged.claimInfo.adjuster = m.entities.claimInfo.adjuster
    if (m.entities.claimInfo.adjusterPhone && !merged.claimInfo.adjusterPhone) merged.claimInfo.adjusterPhone = m.entities.claimInfo.adjusterPhone
    if (m.entities.claimInfo.adjusterEmail && !merged.claimInfo.adjusterEmail) merged.claimInfo.adjusterEmail = m.entities.claimInfo.adjusterEmail
    if (m.entities.claimInfo.dateOfLoss && !merged.claimInfo.dateOfLoss) merged.claimInfo.dateOfLoss = m.entities.claimInfo.dateOfLoss
    if (m.entities.claimInfo.deductible != null && merged.claimInfo.deductible == null) merged.claimInfo.deductible = m.entities.claimInfo.deductible
    if (m.entities.claimInfo.rcv != null && merged.claimInfo.rcv == null) merged.claimInfo.rcv = m.entities.claimInfo.rcv
    if (m.entities.claimInfo.acv != null && merged.claimInfo.acv == null) merged.claimInfo.acv = m.entities.claimInfo.acv
    if (m.entities.claimInfo.depreciation != null && merged.claimInfo.depreciation == null) merged.claimInfo.depreciation = m.entities.claimInfo.depreciation
    if (m.entities.project.address && !merged.project.address) merged.project.address = m.entities.project.address
  }

  missing.claimNumber = !merged.claimInfo.claimNumber
  missing.policyNumber = !merged.claimInfo.policyNumber
  missing.carrier = !merged.claimInfo.carrier
  missing.insured = !merged.claimInfo.insured && !merged.customer.name
  missing.adjuster = !merged.claimInfo.adjuster
  missing.adjusterContact = !merged.claimInfo.adjusterPhone && !merged.claimInfo.adjusterEmail
  missing.dateOfLoss = !merged.claimInfo.dateOfLoss
  missing.deductible = merged.claimInfo.deductible == null
  missing.rcv = merged.claimInfo.rcv == null
  missing.acv = merged.claimInfo.acv == null
  missing.depreciation = merged.claimInfo.depreciation == null
  missing.propertyAddress = !merged.project.address && !merged.customer.address
  // lineItems and totals are determined by AI extraction, not regex — caller can override
  missing.lineItems = false  // will be set by caller based on AI extractedData
  missing.totals = false     // will be set by caller based on AI extractedData

  return missing
}

// ---------------------------------------------------------------------------
// Compute field presence per method
// ---------------------------------------------------------------------------

function computeFieldPresence(methods: ExtractionMethodResult[]): Record<string, Record<string, boolean>> {
  const presence: Record<string, Record<string, boolean>> = {}
  for (const field of KEY_FIELDS) {
    presence[field.key] = {}
    for (const m of methods) {
      const v = field.get(m.entities)
      presence[field.key][m.method] = v != null && v !== ''
    }
  }
  return presence
}

// ---------------------------------------------------------------------------
// Compute agreement score (0-100) — how much methods agree on key fields
// ---------------------------------------------------------------------------

function computeAgreementScore(methods: ExtractionMethodResult[], presence: Record<string, Record<string, boolean>>): number {
  const activeMethods = methods.filter(m => m.available)
  if (activeMethods.length < 2) return 100 // single method = no disagreement possible

  let totalFields = 0
  let agreedFields = 0
  for (const field of KEY_FIELDS) {
    const methodsWithField = activeMethods.filter(m => presence[field.key][m.method])
    if (methodsWithField.length === 0) continue // field missing everywhere — doesn't count
    totalFields++
    if (methodsWithField.length === 1) continue // only one method found it — no disagreement
    // Check if all methods that found it agree
    const accessor = field
    const values = methodsWithField.map(m => accessor.get(m.entities))
    const allEqual = values.every((v, _i, arr) => valuesEqual(v, arr[0]))
    if (allEqual) agreedFields++
  }
  if (totalFields === 0) return 100
  return Math.round((agreedFields / totalFields) * 100)
}

// ---------------------------------------------------------------------------
// Compute overall confidence score (0-100)
// ---------------------------------------------------------------------------

function computeConfidence(args: {
  methods: ExtractionMethodResult[]
  agreementScore: number
  conflicts: ConflictFlags
  missingData: MissingDataFlags
  ocrProviderConfigured: boolean
}): { confidence: number; reason: string } {
  const { methods, agreementScore, conflicts, missingData, ocrProviderConfigured } = args
  const activeMethods = methods.filter(m => m.available)

  let score = 50 // base
  const parts: string[] = []

  // Method count bonus (more methods = more confidence)
  if (activeMethods.length >= 2) { score += 15; parts.push('+15 multi-method') }
  else if (activeMethods.length === 1) { score -= 5; parts.push('-5 single-method') }

  // OCR provider configured bonus
  if (ocrProviderConfigured) { score += 10; parts.push('+10 OCR configured') }
  else { score -= 10; parts.push('-10 OCR not configured') }

  // Best quality score across methods (up to 20)
  const bestQuality = Math.max(...activeMethods.map(m => m.qualityScore), 0)
  const qualityBonus = Math.round((bestQuality / 100) * 20)
  score += qualityBonus
  parts.push(`+${qualityBonus} best quality ${bestQuality}/100`)

  // Agreement score (up to 15)
  const agreementBonus = Math.round((agreementScore / 100) * 15)
  score += agreementBonus
  parts.push(`+${agreementBonus} agreement ${agreementScore}/100`)

  // Conflict penalties (-8 each, max -40)
  const conflictCount = Object.values(conflicts).filter(Boolean).length
  const conflictPenalty = Math.min(40, conflictCount * 8)
  score -= conflictPenalty
  if (conflictPenalty > 0) parts.push(`-${conflictPenalty} ${conflictCount} conflicts`)

  // Missing data penalties (-3 each, max -30)
  const missingCount = Object.values(missingData).filter(Boolean).length
  const missingPenalty = Math.min(30, missingCount * 3)
  score -= missingPenalty
  if (missingPenalty > 0) parts.push(`-${missingPenalty} ${missingCount} missing fields`)

  score = Math.max(0, Math.min(100, score))
  return { confidence: score, reason: parts.join(', ') }
}

// ---------------------------------------------------------------------------
// Generate review notes (actionable recommendations for human review)
// ---------------------------------------------------------------------------

function generateReviewNotes(
  conflicts: ConflictFlags,
  missingData: MissingDataFlags,
  methods: ExtractionMethodResult[],
  warnings: string[],
): string[] {
  const notes: string[] = []
  const activeMethods = methods.filter(m => m.available)

  // Conflict-based notes
  if (conflicts.claimNumberMismatch) notes.push('⚠️ Claim number differs between extraction methods — verify against source document.')
  if (conflicts.carrierMismatch) notes.push('⚠️ Insurance carrier name differs between methods — confirm correct carrier.')
  if (conflicts.customerMismatch) notes.push('⚠️ Insured/customer name differs between methods — verify spelling.')
  if (conflicts.addressMismatch) notes.push('⚠️ Property address differs between methods — verify correct loss location.')
  if (conflicts.rcvMismatch) notes.push('⚠️ RCV (Replacement Cost Value) differs between methods — verify total.')
  if (conflicts.acvMismatch) notes.push('⚠️ ACV (Actual Cash Value) differs between methods — verify depreciation calc.')
  if (conflicts.deductibleMismatch) notes.push('⚠️ Deductible differs between methods — verify policy deductible.')
  if (conflicts.dateOfLossMismatch) notes.push('⚠️ Date of loss differs between methods — confirm correct date.')
  if (conflicts.adjusterMismatch) notes.push('⚠️ Adjuster name differs between methods — verify contact info.')

  // Missing data notes
  if (missingData.claimNumber) notes.push('Claim number not found in any extraction — manual entry may be required.')
  if (missingData.policyNumber) notes.push('Policy number not found — request from customer if needed.')
  if (missingData.carrier) notes.push('Insurance carrier not identified — confirm with customer.')
  if (missingData.insured) notes.push('Insured name not found — verify customer record.')
  if (missingData.adjuster) notes.push('Adjuster not identified — may need to contact carrier.')
  if (missingData.dateOfLoss) notes.push('Date of loss not found — confirm with customer.')
  if (missingData.rcv && missingData.acv) notes.push('Neither RCV nor ACV found — document may be incomplete or a different document type.')
  else if (missingData.rcv) notes.push('RCV not found — verify estimate total.')
  else if (missingData.acv) notes.push('ACV not found — verify depreciation calculation.')
  if (missingData.deductible) notes.push('Deductible not found — confirm with policy.')
  if (missingData.propertyAddress) notes.push('Property/loss address not found — verify job site.')
  if (missingData.lineItems) notes.push('No line items extracted — document may lack itemized scope.')
  if (missingData.totals) notes.push('No totals extracted — verify document is a complete estimate.')

  // Method-availability notes
  if (activeMethods.length === 1) {
    notes.push(`Only one extraction method succeeded (${activeMethods[0].method}) — consider manual review for accuracy.`)
  }

  // Warning-based notes
  for (const w of warnings) notes.push(w)

  return notes
}

// ---------------------------------------------------------------------------
// Main entry: compare extractions
// ---------------------------------------------------------------------------

export function compareExtractions(args: {
  embeddedText: string | null
  visionText: string | null
  aiExtractedData?: Record<string, unknown> | null
  ocrProviderConfigured: boolean
  warnings?: string[]
}): ComparisonResult {
  const { embeddedText, visionText, ocrProviderConfigured, warnings = [] } = args

  // Build per-method results
  const methods: ExtractionMethodResult[] = []
  if (embeddedText && embeddedText.trim().length > 0) {
    methods.push(buildMethodResult('embedded', embeddedText))
  }
  if (visionText && visionText.trim().length > 0) {
    methods.push(buildMethodResult('vision', visionText))
  }

  // Field presence per method
  const fieldPresence = computeFieldPresence(methods)

  // Agreement score
  const agreementScore = computeAgreementScore(methods, fieldPresence)

  // Detect conflicts and missing data
  const conflicts = detectConflicts(methods)
  let missingData = detectMissingData(methods)

  // If AI extracted data has line items / totals, override those missing flags
  if (args.aiExtractedData) {
    const ai = args.aiExtractedData
    if (Array.isArray(ai.lineItems) && ai.lineItems.length > 0) missingData.lineItems = false
    else missingData.lineItems = true
    if (ai.totalAmount != null || (ai.claimInfo && (ai.claimInfo as any).rcv != null)) missingData.totals = false
    else missingData.totals = true
  }

  // Vision-only vs embedded-only content detection
  const embeddedLen = embeddedText?.length ?? 0
  const visionLen = visionText?.length ?? 0
  const visionOnlyContent = visionLen > 100 && embeddedLen < 50
  const embeddedOnlyContent = embeddedLen > 100 && visionLen < 50

  const comparison: ExtractionComparison = {
    methods: methods.map(m => ({
      method: m.method,
      available: m.available,
      textLength: m.textLength,
      qualityScore: m.qualityScore,
      qualityReason: m.qualityReason,
      keywordHits: m.keywordHits,
      structureHits: m.structureHits,
      entities: m.entities,
    })),
    fieldPresence,
    agreementScore,
    visionOnlyContent,
    embeddedOnlyContent,
    mergedTextLength: (embeddedText?.length ?? 0) + (visionText?.length ?? 0),
  }

  // Confidence
  const { confidence, reason } = computeConfidence({
    methods,
    agreementScore,
    conflicts,
    missingData,
    ocrProviderConfigured,
  })

  // Review notes
  const reviewNotes = generateReviewNotes(conflicts, missingData, methods, warnings)

  return {
    comparison,
    conflicts,
    missingData,
    confidence,
    confidenceReason: reason,
    reviewNotes,
    warnings,
  }
}
