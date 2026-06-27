// =============================================================================
// PDF Page → Image Renderer
// =============================================================================
// Uses the installed Sharp/libvips runtime only. If the deployment image can
// rasterize PDFs, scanned PDF OCR can pass rendered page images to vision. If
// the platform Sharp build lacks PDF support, callers get an empty page list
// and the document worker marks the file as needing OCR/review instead of
// hanging or pretending extraction succeeded.
// =============================================================================

import { readStoredFile } from '@/lib/storage'
import sharp from 'sharp'

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

/**
 * Render PDF pages to PNG buffers.
 */
export async function renderPdfPages(filePath: string, opts: RenderOptions = {}): Promise<RenderedPage[]> {
  return renderPdfPagesWithSharp(filePath, opts)
}

async function renderPdfPagesWithSharp(filePath: string, opts: RenderOptions = {}): Promise<RenderedPage[]> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const density = Math.round((opts.scale ?? DEFAULT_SCALE) * 96)
  const buffer = await readStoredFile(filePath)
  const pages: RenderedPage[] = []

  for (let i = 0; i < maxPages; i++) {
    try {
      const rendered = await sharp(buffer, { density, page: i, pages: 1 })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer({ resolveWithObject: true })
      pages.push({
        pageNumber: i + 1,
        buffer: rendered.data,
        width: rendered.info.width,
        height: rendered.info.height,
      })
    } catch (err) {
      if (i === 0) {
        console.warn('[pdf-to-images] sharp PDF render failed:', err)
      }
      break
    }
  }

  return pages
}

/**
 * Render a PDF page to a base64 data URL (for vision APIs).
 */
export function pageToDataUrl(page: RenderedPage): string {
  return `data:image/png;base64,${page.buffer.toString('base64')}`
}
