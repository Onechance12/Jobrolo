// =============================================================================
// Extraction Quality Scorer
// =============================================================================
// Scores PDF text extraction quality on a 0-100 scale.
// If score < threshold (default 35), the document worker triggers OCR fallback.
//
// Score factors:
//   - character count (log-scaled)
//   - word count (log-scaled)
//   - ratio of alphanumeric chars (filter out garbage extraction)
//   - presence of insurance/contractor keywords
//   - presence of common document structure (dates, dollar amounts, line items)
// =============================================================================

export interface QualityScore {
  score: number          // 0-100
  charCount: number
  wordCount: number
  alphaNumericRatio: number
  keywordHits: string[]
  structureHits: string[]
  reason: string
  shouldTriggerOcr: boolean
}

// Insurance / contractor keywords — case-insensitive match
const INSURANCE_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bclaim\s*(number|#|no\.?)\b/i, label: 'claim_number' },
  { pattern: /\bpolicy\s*(number|#|no\.?)\b/i, label: 'policy_number' },
  { pattern: /\binsured\b/i, label: 'insured' },
  { pattern: /\bcarrier\b/i, label: 'carrier' },
  { pattern: /\badjuster\b/i, label: 'adjuster' },
  { pattern: /\bdeductible\b/i, label: 'deductible' },
  { pattern: /\bACV\b/, label: 'acv' },
  { pattern: /\bRCV\b/, label: 'rcv' },
  { pattern: /\breplacement cost\b/i, label: 'replacement_cost' },
  { pattern: /\bdate of loss\b/i, label: 'date_of_loss' },
  { pattern: /\bscope of loss\b/i, label: 'scope_of_loss' },
  { pattern: /\bdepreciation\b/i, label: 'depreciation' },
  { pattern: /\bmortgage\b/i, label: 'mortgage' },
  { pattern: /\blienholder\b/i, label: 'lienholder' },
]

const CONTRACTOR_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bshingle/i, label: 'shingle' },
  { pattern: /\broof/i, label: 'roof' },
  { pattern: /\belevation\b/i, label: 'elevation' },
  { pattern: /\btrade\b/i, label: 'trade' },
  { pattern: /\bestimate\b/i, label: 'estimate' },
  { pattern: /\binvoice\b/i, label: 'invoice' },
  { pattern: /\bline item\b/i, label: 'line_item' },
  { pattern: /\btear off\b/i, label: 'tear_off' },
  { pattern: /\bunderlayment\b/i, label: 'underlayment' },
  { pattern: /\bflashing\b/i, label: 'flashing' },
  { pattern: /\bgutter/i, label: 'gutter' },
  { pattern: /\bsquare\s*(feet|ft|sq)\b/i, label: 'square_feet' },
  { pattern: /\bSQ\b/, label: 'sq' },
  { pattern: /\bmaterial/i, label: 'material' },
  { pattern: /\blabor\b/i, label: 'labor' },
  { pattern: /\bpermit\b/i, label: 'permit' },
  { pattern: /\binspection\b/i, label: 'inspection' },
  { pattern: /\bchange order\b/i, label: 'change_order' },
  { pattern: /\bsupplement\b/i, label: 'supplement' },
]

// Document structure signals
const STRUCTURE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/, label: 'dollar_amount' },     // $1,234.56
  { pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, label: 'date' },                     // 01/15/2024
  { pattern: /\b\d{1,2}-\d{1,2}-\d{2,4}\b/, label: 'date_dash' },                  // 01-15-2024
  { pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b/i, label: 'date_long' },
  { pattern: /\b\d{3}[-.)\s]\d{3}[-.]\d{4}\b/, label: 'phone' },                   // (555) 123-4567
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, label: 'email' },
  { pattern: /\b\d+\s+(?:SQ|LF|EA|SF|SY|HR|PCS|BOX|ROLL|BUNDLE)\b/i, label: 'quantity_unit' },
  { pattern: /\b\d+\.\s+[A-Z]/, label: 'numbered_list' },                         // 1. Description
]

const MIN_CHARS_FOR_QUALITY = 50
const OCR_TRIGGER_THRESHOLD = 35

export function scoreExtraction(text: string | null | undefined): QualityScore {
  const charCount = text?.length ?? 0
  const trimmed = text?.trim() ?? ''

  if (charCount < MIN_CHARS_FOR_QUALITY) {
    return {
      score: 0,
      charCount,
      wordCount: 0,
      alphaNumericRatio: 0,
      keywordHits: [],
      structureHits: [],
      reason: `Too little text (${charCount} chars < ${MIN_CHARS_FOR_QUALITY} minimum)`,
      shouldTriggerOcr: true,
    }
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  // Alphanumeric ratio — filter out garbage extraction (e.g. PDFs that extract
  // as random glyphs or single-character noise)
  const alphaNumChars = (text!.match(/[a-zA-Z0-9]/g) ?? []).length
  const alphaNumericRatio = alphaNumChars / charCount

  // Keyword hits (insurance + contractor)
  const keywordHits: string[] = []
  for (const { pattern, label } of [...INSURANCE_KEYWORDS, ...CONTRACTOR_KEYWORDS]) {
    if (pattern.test(text!)) keywordHits.push(label)
  }

  // Structure hits
  const structureHits: string[] = []
  for (const { pattern, label } of STRUCTURE_PATTERNS) {
    if (pattern.test(text!)) structureHits.push(label)
  }

  // Score calculation (0-100)
  // - char count: log-scaled, max 25 points (caps at 10k chars)
  const charScore = Math.min(25, Math.log10(Math.max(10, charCount)) * 6.25)
  // - word count: log-scaled, max 20 points (caps at 1500 words)
  const wordScore = Math.min(20, Math.log10(Math.max(10, wordCount)) * 6.0)
  // - alphanumeric ratio: max 20 points (penalize garbage)
  const ratioScore = alphaNumericRatio > 0.7 ? 20 : alphaNumericRatio > 0.5 ? 12 : alphaNumericRatio > 0.3 ? 5 : 0
  // - keyword hits: max 20 points (2.5 per hit, 8 hit cap)
  const keywordScore = Math.min(20, keywordHits.length * 2.5)
  // - structure hits: max 15 points (3 per hit, 5 hit cap)
  const structureScore = Math.min(15, structureHits.length * 3)

  const score = Math.round(charScore + wordScore + ratioScore + keywordScore + structureScore)

  // Determine reason
  const parts: string[] = []
  parts.push(`${charCount} chars`)
  parts.push(`${wordCount} words`)
  parts.push(`alpha ${(alphaNumericRatio * 100).toFixed(0)}%`)
  if (keywordHits.length) parts.push(`${keywordHits.length} keywords`)
  if (structureHits.length) parts.push(`${structureHits.length} structure signals`)
  const reason = parts.join(', ')

  return {
    score: Math.min(100, score),
    charCount,
    wordCount,
    alphaNumericRatio,
    keywordHits,
    structureHits,
    reason,
    shouldTriggerOcr: score < OCR_TRIGGER_THRESHOLD,
  }
}
