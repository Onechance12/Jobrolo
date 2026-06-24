// =============================================================================
// Upload Security — magic-byte validation, size limits, path traversal defense
// =============================================================================

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB
export const MAX_FILES_PER_UPLOAD = 10
export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
  'text/plain',
  'application/octet-stream', // fallback for HEIC (browsers don't know HEIC)
])

// Magic bytes: first N bytes that uniquely identify file types
const MAGIC_BYTES: Array<{ bytes: number[]; mime: string; ext: string }> = [
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg', ext: '.jpg' },
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mime: 'image/png', ext: '.png' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp', ext: '.webp' }, // RIFF (could be webp/wav/avi)
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2D], mime: 'application/pdf', ext: '.pdf' },
  { bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/zip', ext: '.zip' }, // docx/xlsx are zip
  { bytes: [0xD0, 0xCF, 0x11, 0xE0], mime: 'application/vnd.ms-office', ext: '.doc' }, // legacy office
  // HEIC files start with "ftyp" at offset 4 — checked separately
]

export interface ValidationResult {
  ok: boolean
  error?: string
  detectedMime?: string
  detectedExt?: string
}

export function detectFromMagicBytes(buf: Buffer): { mime: string; ext: string } | null {
  for (const { bytes, mime, ext } of MAGIC_BYTES) {
    if (buf.length < bytes.length) continue
    if (bytes.every((b, i) => buf[i] === b)) {
      // Disambiguate RIFF (webp vs wav vs avi)
      if (mime === 'image/webp') {
        const format = buf.slice(8, 12).toString('ascii')
        if (format === 'WEBP') return { mime: 'image/webp', ext: '.webp' }
        return null // not webp, reject
      }
      // Disambiguate zip (docx vs xlsx vs plain zip)
      if (mime === 'application/zip') {
        // Office .docx/.xlsx files store their internal structure throughout
        // the file. Scan a larger window to find the word/ or xl/ markers.
        // (The ZIP central directory is at the end, but local file headers
        // appear throughout the body.)
        const scanSize = Math.min(buf.length, 32_000)
        const head = buf.slice(0, scanSize).toString('latin1')
        if (head.includes('word/')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' }
        if (head.includes('xl/')) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' }
        // Also check the original filename as a hint
        return null // plain zip, reject
      }
      return { mime, ext }
    }
  }
  // HEIC: check for 'ftypheic' / 'ftypheix' / 'ftypmif1' at offset 4
  if (buf.length >= 12) {
    const ftyp = buf.slice(4, 12).toString('ascii')
    if (['ftypheic', 'ftypheix', 'ftyphevc', 'ftypmif1'].includes(ftyp)) {
      return { mime: 'image/heic', ext: '.heic' }
    }
  }
  // CSV/text: check if all bytes are printable ASCII or common UTF-8 BOM
  if (buf.length > 0 && buf.length < 5_000_000) {
    const sample = buf.slice(0, Math.min(buf.length, 1024))
    const isText = sample.every(b => b === 0x09 || b === 0x0A || b === 0x0D || (b >= 0x20 && b <= 0x7E) || b >= 0x80)
    if (isText) {
      const ext = path.extname(buf.toString('utf8').slice(0, 100)).toLowerCase()
      return { mime: 'text/plain', ext: ext || '.txt' }
    }
  }
  return null
}

export function validateUpload(file: { name: string; type: string; size: number; data: ArrayBuffer | Buffer }): ValidationResult {
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }
  }
  if (file.size === 0) {
    return { ok: false, error: 'Empty file' }
  }

  const buffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data)
  const detected = detectFromMagicBytes(buffer)

  // SECURITY: No extension-based fallback. If magic bytes don't match, reject.
  // This prevents renamed executables (e.g., malware.exe → claim.pdf) from
  // being accepted. Only magic-byte detection is trusted.
  if (!detected) {
    return { ok: false, error: 'File type not recognized or file may be corrupted. Supported types: PDF, JPG, PNG, WEBP, HEIC, DOCX, XLSX, TXT, CSV.' }
  }

  return { ok: true, detectedMime: detected.mime, detectedExt: detected.ext }
}

export function safeFilename(original: string): string {
  const base = path.basename(original).replace(/[^\w.\-]+/g, '_').replace(/\.{2,}/g, '.')
  return base.slice(0, 200) // cap length
}
