// =============================================================================
// Document OCR Provider — pluggable OCR abstraction
// =============================================================================
// Stable abstraction for OCR fallback. The default provider is `NoOcrProvider`
// which always returns null — meaning scanned PDFs are marked `needs_ocr` with
// a clear reason "OCR provider not configured."
//
// To enable OCR, set OCR_PROVIDER env var and configure the corresponding
// credentials. Provider implementations are stubs that throw "not implemented"
// until wired up — they exist so the integration surface is clear.
//
// Future providers (priority order):
//   1. openai_vision   — configured OpenAI-compatible vision provider
//   2. google_vision   — Google Cloud Vision API
//   3. aws_textract    — AWS Textract
//   4. apilayer_ocr    — APILayer OCR.space
//   5. azure_vision    — Azure Computer Vision
//
// Each provider implements:
//   - extractFromPdf(filePath): extract text from a PDF (rendering pages internally)
//   - extractFromImage(filePath): extract text from an image file
//   - isAvailable(): returns true if credentials are configured
// =============================================================================

import { readStoredFile } from '@/lib/storage'
import { promises as fs } from 'node:fs'
import { analyzeImage } from '@/lib/ai'

export interface OcrResult {
  text: string
  pageCount?: number
  confidence?: number
  provider: string
}

export interface DocumentOcrProvider {
  /** Provider identifier — e.g. "openai_vision", "google_vision" */
  readonly name: string
  /** Returns true if this provider has credentials/config available */
  isAvailable(): boolean
  /** Extract text from a PDF file. Returns null on failure. */
  extractFromPdf(filePath: string): Promise<OcrResult | null>
  /** Extract text from an image file. Returns null on failure. */
  extractFromImage(filePath: string): Promise<OcrResult | null>
}

// ---------------------------------------------------------------------------
// Default provider: no OCR configured. Always returns null with a clear reason.
// ---------------------------------------------------------------------------

export class NoOcrProvider implements DocumentOcrProvider {
  readonly name = 'none'

  isAvailable(): boolean {
    return false
  }

  async extractFromPdf(_filePath: string): Promise<OcrResult | null> {
    return null
  }

  async extractFromImage(_filePath: string): Promise<OcrResult | null> {
    return null
  }
}

// ---------------------------------------------------------------------------
// Stub providers — exist so the integration surface is documented. Each one
// throws "not implemented" if called, but `isAvailable()` returns false until
// credentials are configured. Replace the body of `extractFromPdf` /
// `extractFromImage` with real implementations when wiring up.
// ---------------------------------------------------------------------------

export class OpenAiVisionOcrProvider implements DocumentOcrProvider {
  readonly name = 'openai_vision'

  isAvailable(): boolean {
    return (process.env.LLM_PROVIDER === 'openai-compatible' || process.env.LLM_PROVIDER === 'openai') && !!process.env.LLM_API_KEY
  }

  async extractFromPdf(filePath: string): Promise<OcrResult | null> {
    console.warn(`[doc-worker] vision OCR PDF skipped for ${filePath}: PDF page rendering dependencies are not installed. Embedded PDF text extraction still runs before this fallback.`)
    return null
  }

  async extractFromImage(filePath: string): Promise<OcrResult | null> {
    console.log('[doc-worker] using vision OCR')
    const buffer = await readStoredFile(filePath)
    const ext = filePath.toLowerCase()
    const mimeType = ext.endsWith('.png') ? 'image/png' : ext.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    const text = await analyzeImage(dataUrl, `Analyze this uploaded roofing/construction image.

If this is a document photo, estimate, scope, price sheet, declaration page, invoice, contract, or screenshot, extract all visible text and tables.
If this is an evidence/damage photo, briefly classify it as roof overview, elevation, hail damage, wind damage, soft metals/gutters, interior, document photo, or other, then describe visible evidence.

Return concise text only.`, { purpose: 'image_analysis', detail: 'high', maxTokens: 2000 })
    if (!text.trim()) return null
    return { provider: this.name, text: text.trim(), confidence: text.length > 200 ? 70 : 45 }
  }
}

export class GoogleVisionOcrProvider implements DocumentOcrProvider {
  readonly name = 'google_vision'

  isAvailable(): boolean {
    return !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.GOOGLE_VISION_API_KEY
  }

  async extractFromPdf(_filePath: string): Promise<OcrResult | null> {
    throw new Error('GoogleVisionOcrProvider.extractFromPdf not implemented — TODO: call documents.detectText with PDF')
  }

  async extractFromImage(_filePath: string): Promise<OcrResult | null> {
    throw new Error('GoogleVisionOcrProvider.extractFromImage not implemented — TODO: call documents.detectText with image')
  }
}

export class AwsTextractOcrProvider implements DocumentOcrProvider {
  readonly name = 'aws_textract'

  isAvailable(): boolean {
    return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_TEXTRACT_REGION)
  }

  async extractFromPdf(_filePath: string): Promise<OcrResult | null> {
    throw new Error('AwsTextractOcrProvider.extractFromPdf not implemented — TODO: call StartDocumentAnalysis')
  }

  async extractFromImage(_filePath: string): Promise<OcrResult | null> {
    throw new Error('AwsTextractOcrProvider.extractFromImage not implemented — TODO: call DetectDocumentText')
  }
}

// ---------------------------------------------------------------------------
// APILayer OCR.space — fully implemented
// ---------------------------------------------------------------------------
// API docs: https://ocr.space/OCRAPI
// Endpoint: POST https://api.ocr.space/parse/image
// Auth: apikey header (or apikey form field)
// Body: multipart/form-data with `file` (or `url`), `language`, `isOverlayRequired`, `scale`, `isTable`, `OCREngine`
// Response: { ParsedResults: [{ ParsedText, TextOverlay, FileParseExitCode, ErrorMessage }], OCRExitCode, IsErroredOnProcessing, ErrorMessage }
//
// For PDFs: same endpoint accepts PDF files directly — no native rendering needed.
// For images: same endpoint accepts PNG/JPG/GIF/BMP/TIFF/WEBP.
//
// Notes:
// - Free tier: 25,000 requests/month, 1MB file size limit, 2 requests/min
// - Paid tiers: higher limits
// - OCREngine 1 = default; OCREngine 2 = better for handwriting + low-quality scans
// - We use OCREngine 2 for higher accuracy on scanned insurance documents.
// ---------------------------------------------------------------------------

const APILAYER_OCR_ENDPOINT = 'https://api.ocr.space/parse/image'
const APILAYER_OCR_ENGINE = 2 // better for handwriting + scanned docs
const APILAYER_OCR_LANGUAGE = 'eng'
const APILAYER_OCR_TIMEOUT_MS = 60_000 // 60 second timeout for large PDFs
const APILAYER_MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB hard cap (we'll log a warning above)

export class ApiLayerOcrProvider implements DocumentOcrProvider {
  readonly name = 'apilayer_ocr'

  isAvailable(): boolean {
    return !!process.env.APILAYER_OCR_API_KEY
  }

  async extractFromPdf(filePath: string): Promise<OcrResult | null> {
    return this._extract(filePath, 'application/pdf')
  }

  async extractFromImage(filePath: string): Promise<OcrResult | null> {
    // Detect mime type from extension
    const ext = filePath.toLowerCase().split('.').pop() ?? ''
    let mimeType = 'image/jpeg'
    if (ext === 'png') mimeType = 'image/png'
    else if (ext === 'gif') mimeType = 'image/gif'
    else if (ext === 'bmp') mimeType = 'image/bmp'
    else if (ext === 'tiff' || ext === 'tif') mimeType = 'image/tiff'
    else if (ext === 'webp') mimeType = 'image/webp'
    return this._extract(filePath, mimeType)
  }

  private async _extract(filePath: string, mimeType: string): Promise<OcrResult | null> {
    const apiKey = process.env.APILAYER_OCR_API_KEY
    if (!apiKey) {
      console.error('[ocr:apilayer] APILAYER_OCR_API_KEY not set — cannot extract')
      return null
    }

    let fileBuffer: Buffer
    let fileSize: number
    try {
      fileBuffer = await readStoredFile(filePath)
      fileSize = fileBuffer.length
      if (fileSize > APILAYER_MAX_FILE_SIZE) {
        console.warn(`[ocr:apilayer] file is ${fileSize} bytes (>${APILAYER_MAX_FILE_SIZE} cap) — API may reject`)
      }
    } catch (err) {
      console.error(`[ocr:apilayer] failed to read file ${filePath}:`, err)
      return null
    }

    const filename = filePath.split('/').pop() ?? 'document'
    console.log(`[ocr:apilayer] request started — file=${filename} (${fileSize} bytes, mime=${mimeType})`)

    // Build multipart/form-data manually (no dependency on form-data package)
    const boundary = `----jobrolo-ocr-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const parts: Buffer[] = []

    // file part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    ))
    parts.push(fileBuffer)
    parts.push(Buffer.from('\r\n'))

    // Required form fields
    const fields: Record<string, string> = {
      language: APILAYER_OCR_LANGUAGE,
      isOverlayRequired: 'false',
      scale: 'true',
      isTable: 'true',     // preserve table layout for estimate line items
      OCREngine: String(APILAYER_OCR_ENGINE),
      filetype: mimeType === 'application/pdf' ? 'PDF' : mimeType.split('/')[1].toUpperCase(),
    }
    for (const [key, value] of Object.entries(fields)) {
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${value}\r\n`
      ))
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(parts)

    // Make the request
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), APILAYER_OCR_TIMEOUT_MS)

    try {
      const res = await fetch(APILAYER_OCR_ENDPOINT, {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: controller.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error(`[ocr:apilayer] HTTP ${res.status} ${res.statusText} — ${errText.slice(0, 200)}`)
        return null
      }

      const data = await res.json() as any
      if (data.IsErroredOnProcessing) {
        console.error(`[ocr:apilayer] processing error: ${data.ErrorMessage ?? 'unknown'}`)
        return null
      }

      // Exit codes: 1=Success, 2=Failed, 3=FileNotFound, 4..=Other errors
      if (data.OCRExitCode && data.OCRExitCode !== 1) {
        console.error(`[ocr:apilayer] non-success exit code ${data.OCRExitCode}: ${data.ErrorMessage ?? 'no message'}`)
        return null
      }

      const parsedResults = Array.isArray(data.ParsedResults) ? data.ParsedResults : []
      if (parsedResults.length === 0) {
        console.warn('[ocr:apilayer] response had no ParsedResults')
        return null
      }

      // Combine text from all parsed pages/results
      const textChunks: string[] = []
      let totalPages = 0
      for (let i = 0; i < parsedResults.length; i++) {
        const r = parsedResults[i]
        if (r.FileParseExitCode && r.FileParseExitCode !== 1) {
          console.warn(`[ocr:apilayer] page ${i + 1} parse exit code ${r.FileParseExitCode}: ${r.ErrorMessage ?? r.ErrorDetails ?? ''}`)
        }
        const pageText = typeof r.ParsedText === 'string' ? r.ParsedText.trim() : ''
        if (pageText) {
          if (parsedResults.length > 1) {
            textChunks.push(`--- PAGE ${i + 1} ---\n${pageText}`)
          } else {
            textChunks.push(pageText)
          }
          totalPages++
        }
      }

      const mergedText = textChunks.join('\n\n')
      if (!mergedText) {
        console.warn('[ocr:apilayer] all ParsedResults had empty text')
        return null
      }

      // Confidence: APILayer doesn't return a single confidence number,
      // but if TextOverlay is available we could compute one. For now, set
      // a reasonable default — the comparison engine will combine this with
      // the quality score from the embedded text.
      const confidence = 75 // baseline for OCR success; comparison engine adjusts

      console.log(`[ocr:apilayer] ✓ extracted ${mergedText.length} chars from ${totalPages} page(s) — file=${filename}`)

      return {
        text: mergedText,
        pageCount: totalPages,
        confidence,
        provider: this.name,
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.error(`[ocr:apilayer] request timed out after ${APILAYER_OCR_TIMEOUT_MS}ms — file=${filename}`)
      } else {
        console.error(`[ocr:apilayer] request failed — file=${filename}:`, err?.message ?? err)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class AzureVisionOcrProvider implements DocumentOcrProvider {
  readonly name = 'azure_vision'

  isAvailable(): boolean {
    return !!(process.env.AZURE_VISION_ENDPOINT && process.env.AZURE_VISION_KEY)
  }

  async extractFromPdf(_filePath: string): Promise<OcrResult | null> {
    throw new Error('AzureVisionOcrProvider.extractFromPdf not implemented — TODO: call Read API with PDF')
  }

  async extractFromImage(_filePath: string): Promise<OcrResult | null> {
    throw new Error('AzureVisionOcrProvider.extractFromImage not implemented — TODO: call Read API with image')
  }
}

// ---------------------------------------------------------------------------
// Provider registry + factory
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, () => DocumentOcrProvider> = {
  none: () => new NoOcrProvider(),
  openai_vision: () => new OpenAiVisionOcrProvider(),
  google_vision: () => new GoogleVisionOcrProvider(),
  aws_textract: () => new AwsTextractOcrProvider(),
  apilayer_ocr: () => new ApiLayerOcrProvider(),
  azure_vision: () => new AzureVisionOcrProvider(),
}

let _cachedProvider: DocumentOcrProvider | null = null

/**
 * Get the configured OCR provider. Reads OCR_PROVIDER env var (default: "none").
 * Returns NoOcrProvider if the configured provider is not available.
 */
export function getOcrProvider(): DocumentOcrProvider {
  if (_cachedProvider) return _cachedProvider

  const providerName = process.env.OCR_PROVIDER || ((process.env.LLM_PROVIDER === 'openai-compatible' || process.env.LLM_PROVIDER === 'openai') ? 'openai_vision' : 'none')
  const factory = PROVIDERS[providerName] ?? PROVIDERS.none
  const provider = factory()

  // If the configured provider says it's not available, fall back to none.
  if (!provider.isAvailable()) {
    console.warn(`[ocr-provider] '${providerName}' is not available (missing credentials) — falling back to NoOcrProvider`)
    _cachedProvider = new NoOcrProvider()
  } else {
    console.log(`[ocr-provider] using '${provider.name}'`)
    _cachedProvider = provider
  }

  return _cachedProvider
}

/**
 * Convenience helper: returns true if any OCR provider is available.
 */
export function isOcrAvailable(): boolean {
  return getOcrProvider().isAvailable()
}

/**
 * Convenience helper: returns a human-readable reason for needs_ocr status.
 */
export function getOcrUnavailableReason(): string {
  const provider = getOcrProvider()
  if (provider.name === 'none') {
    return 'OCR provider not configured. Set OCR_PROVIDER env var to one of: openai_vision, google_vision, aws_textract, apilayer_ocr, azure_vision.'
  }
  return `OCR provider '${provider.name}' is configured but not available (missing credentials).`
}
