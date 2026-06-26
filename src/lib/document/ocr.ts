// =============================================================================
// Vision-based OCR helpers — used by future DocumentOcrProvider implementations
// =============================================================================
// These are low-level vision API helpers, NOT called directly by the document
// worker. The worker calls `getOcrProvider()` from `ocr-provider.ts`.
//
// When implementing OpenAiVisionOcrProvider (or similar), use these helpers:
//   - ocrImage(buffer, mimeType) — raw text from a single image
//   - visionExtractStructured(buffer, mimeType) — structured entity extraction
//   - extractStructuredFromText(text) — structured extraction from plain text
// =============================================================================

import { analyzeImage } from '@/lib/ai'

const OCR_PROMPT = `You are an OCR engine for construction and insurance documents. Extract ALL text from this image exactly as it appears.

Rules:
1. Preserve the original layout — use line breaks where the original has line breaks.
2. Preserve numbers, dollar amounts, dates, phone numbers, claim numbers exactly.
3. Preserve table structure using spaces or pipe characters.
4. Do not add commentary, summaries, or explanations.
5. If the image contains handwriting, transcribe it as best you can.
6. If part of the image is illegible, write [illegible] for that portion.
7. Output ONLY the extracted text. No JSON, no markdown fences, no preamble.

Extract the text now:`

const STRUCTURED_VISION_PROMPT = `You are a document intelligence engine analyzing a construction/insurance document image.

Extract ALL of the following that are visible in the image. If a field is not present, omit it. Respond as JSON only (no markdown fences).

{
  "documentType": "estimate | scope_of_loss | carrier_letter | inspection_report | invoice | receipt | contract | claim_document | mortgage_document | customer_document | photo | other",
  "summary": "1-2 sentence summary of what this document is",
  "claimInfo": {
    "claimNumber": "string or omit",
    "policyNumber": "string or omit",
    "carrier": "string or omit",
    "insured": "string or omit",
    "adjuster": "string or omit",
    "adjusterPhone": "string or omit",
    "adjusterEmail": "string or omit",
    "dateOfLoss": "string or omit",
    "deductible": "number or omit",
    "rcv": "number or omit",
    "acv": "number or omit",
    "depreciation": "number or omit",
    "mortgageCompany": "string or omit"
  },
  "customer": {
    "name": "string or omit",
    "address": "string or omit",
    "phone": "string or omit",
    "email": "string or omit"
  },
  "project": {
    "address": "string or omit",
    "description": "string or omit"
  },
  "lineItems": [
    {"description": "string", "quantity": "number or null", "unit": "string or null", "unitPrice": "number or null", "total": "number or null"}
  ],
  "materials": [
    {"name": "string", "quantity": "number or null", "unit": "string or null", "unitCost": "number or null"}
  ],
  "totals": {
    "subtotal": "number or omit",
    "tax": "number or omit",
    "total": "number or omit"
  },
  "dates": ["any dates mentioned"],
  "phones": ["any phone numbers"],
  "emails": ["any email addresses"],
  "rawText": "FULL verbatim text transcription of the image (preserve line breaks)"
}`

/**
 * OCR a single image (PNG/JPG/HEIC buffer) using the vision model.
 * Returns raw extracted text only.
 *
 * Used by: future OpenAiVisionOcrProvider implementation
 */
export async function ocrImage(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<string> {
  try {
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`
    return await analyzeImage(dataUrl, OCR_PROMPT, { purpose: 'document_extraction', detail: 'high', maxTokens: 2000 })
  } catch (err) {
    console.error('[ocr] ocrImage failed:', err)
    return ''
  }
}

/**
 * Structured vision extraction — combines OCR + entity extraction in one call.
 * Used for image documents (JPG, PNG, HEIC).
 *
 * Used by: future OpenAiVisionOcrProvider implementation
 */
export async function visionExtractStructured(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<Record<string, unknown> | null> {
  try {
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`
    const content = await analyzeImage(dataUrl, STRUCTURED_VISION_PROMPT, { purpose: 'document_extraction', detail: 'high', maxTokens: 3000 })
    let cleaned = content.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    }
    return JSON.parse(cleaned)
  } catch (err) {
    console.error('[vision] structured extraction failed:', err)
    return null
  }
}

/**
 * Run structured extraction on plain text (used after OCR or after PDF text extraction).
 *
 * Used by: future OpenAiVisionOcrProvider implementation
 */
export async function extractStructuredFromText(text: string, hint?: string): Promise<Record<string, unknown> | null> {
  if (!text || text.trim().length < 30) return null
  try {
    const { chatComplete } = await import('@/lib/ai')
    const hintStr = hint ? `\nDocument hint: ${hint}` : ''
    const r = await chatComplete([
      {
        role: 'system',
        content: `You are a document intelligence engine. Analyze this extracted text and return structured JSON only (no markdown fences).${hintStr}\n\n${STRUCTURED_VISION_PROMPT}`,
      },
      { role: 'user', content: text.slice(0, 12000) },
    ], { temperature: 0.1, maxTokens: 2500 })
    let c = r.trim()
    if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    return JSON.parse(c)
  } catch (err) {
    console.error('[vision] extractStructuredFromText failed:', err)
    return null
  }
}
