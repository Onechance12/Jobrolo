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
  const headLen = Math.floor(maxChars * 0.55)
  const tailLen = Math.floor(maxChars * 0.25)
  const middleLen = Math.max(0, maxChars - headLen - tailLen - 80)
  const middleStart = Math.max(0, Math.floor(text.length / 2) - Math.floor(middleLen / 2))
  const middle = middleLen > 500 ? `\n\n[... middle sample ...]\n\n${text.slice(middleStart, middleStart + middleLen)}` : ''
  return `${text.slice(0, headLen)}${middle}\n\n[... truncated ${text.length - maxChars} chars from large document ...]\n\n${text.slice(-tailLen)}`
}
