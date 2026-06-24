// =============================================================================
// PDF Page → Image Renderer (using pdfjs-dist + @napi-rs/canvas directly)
// =============================================================================
// Bypasses unpdf's renderPageAsImage because its bundled pdfjs.mjs has a
// NodeCanvasFactory that always throws "@napi-rs/canvas is not available in
// this environment" when bundled by Turbopack — even when canvasImport is
// provided. Using pdfjs-dist directly with our own canvas factory avoids
// that broken code path.
// =============================================================================

import { promises as fs } from 'node:fs'
import { readStoredFile } from '@/lib/storage'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)

export interface RenderedPage {
  pageNumber: number
  buffer: Buffer
  width: number
  height: number
}

export interface RenderOptions {
  scale?: number
  maxPages?: number
}

const DEFAULT_SCALE = 1.5
const DEFAULT_MAX_PAGES = 10

// Cache loaded modules so we only load them once
let _canvas: any = null
let _pdfjs: any = null

function loadCanvas() {
  if (!_canvas) {
    _canvas = require_('@napi-rs/canvas')
    // Inject globals that pdfjs expects
    const g = globalThis as any
    if (_canvas.DOMMatrix) g.DOMMatrix = _canvas.DOMMatrix
    if (_canvas.ImageData && typeof g.ImageData === 'undefined') g.ImageData = _canvas.ImageData
    if (_canvas.Path2D && typeof g.Path2D === 'undefined') g.Path2D = _canvas.Path2D
  }
  return _canvas
}

async function loadPdfjs() {
  if (!_pdfjs) {
    // Load the legacy build for Node.js compatibility
    const pdfjsPath = require_.resolve('pdfjs-dist/legacy/build/pdf.mjs')
    _pdfjs = await import(pdfjsPath)
  }
  return _pdfjs
}

/**
 * Render PDF pages to PNG buffers.
 */
export async function renderPdfPages(filePath: string, opts: RenderOptions = {}): Promise<RenderedPage[]> {
  const scale = opts.scale ?? DEFAULT_SCALE
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES

  const canvas = loadCanvas()
  const pdfjs = await loadPdfjs()

  // pdfjs needs to know where standard fonts live
  const standardFontDataUrl = require_.resolve('pdfjs-dist/legacy/build/pdf.mjs')
    .replace(/pdf\.mjs$/, '../standard_fonts/')

  const buffer = await readStoredFile(filePath)
  const data = new Uint8Array(buffer)

  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl,
    isEvalSupported: false,
  })
  const pdf = await loadingTask.promise

  const pageCount = Math.min(pdf.numPages, maxPages)
  const pages: RenderedPage[] = []

  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale })
      const width = Math.floor(viewport.width)
      const height = Math.floor(viewport.height)
      const pageCanvas = canvas.createCanvas(width, height)
      const context = pageCanvas.getContext('2d')
      // White background (PDFs default to transparent)
      context.fillStyle = 'white'
      context.fillRect(0, 0, width, height)

      await page.render({
        canvasContext: context,
        viewport,
      } as any).promise

      const pngBuffer = pageCanvas.toBuffer('image/png')
      pages.push({
        pageNumber: i,
        buffer: Buffer.from(pngBuffer),
        width,
        height,
      })
    } catch (err) {
      console.error(`[pdf-to-images] page ${i} render failed:`, err)
    }
  }

  // Cleanup pdf document
  try { await pdf.destroy() } catch {}

  return pages
}

/**
 * Render a PDF page to a base64 data URL (for vision APIs).
 */
export function pageToDataUrl(page: RenderedPage): string {
  return `data:image/png;base64,${page.buffer.toString('base64')}`
}
