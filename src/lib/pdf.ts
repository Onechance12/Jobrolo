import { extractText, getDocumentProxy } from 'unpdf'
import { readStoredFile } from '@/lib/storage'

export interface PdfExtractResult { text: string; pageCount: number; info?: Record<string, unknown> }

export async function extractPdfText(filePath: string): Promise<PdfExtractResult> {
  try {
    const buffer = await readStoredFile(filePath)
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const result = await extractText(pdf, { mergePages: true })
    return { text: result.text || '', pageCount: pdf.numPages || 0 }
  } catch (err) { console.error('[pdf] extract failed:', err); return { text: '', pageCount: 0 } }
}

export function truncateForAI(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text
  const t = text.slice(0, maxChars)
  const last = Math.max(t.lastIndexOf('. '), t.lastIndexOf('\n'))
  return (last > maxChars * 0.8 ? t.slice(0, last + 1) : t) + '\n\n[... truncated ...]'
}
