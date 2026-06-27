import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readFile, readStoredFile } from '@/lib/storage'
import { requireContext } from '@/lib/security/context'
import { requireDocument } from '@/lib/security/ownership'

export const runtime = 'nodejs'

const ALLOWED_DIRS = new Set(['photos', 'docs', 'thumbnails', 'tts-cache'])

function safeParam(value: string) {
  const decoded = decodeURIComponent(value)
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return null
  return path.basename(decoded)
}

function contentType(filename: string, fallback?: string | null) {
  if (fallback) return fallback
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.heic') return 'image/heic'
  if (ext === '.heif') return 'image/heif'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.csv') return 'text/csv'
  if (ext === '.txt') return 'text/plain; charset=utf-8'
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return 'application/octet-stream'
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ dir: string; filename: string }> }) {
  const ctx = await requireContext(_req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const { dir, filename } = await params
  const safeDir = safeParam(dir)
  const safeName = safeParam(filename)
  if (!safeDir || !safeName || !ALLOWED_DIRS.has(safeDir)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const document = await db.document.findFirst({
    where: {
      contractorId: ctx.contractorId,
      OR: [
        { filename: safeName },
        { filePath: { endsWith: `/uploads/${safeDir}/${safeName}` } },
        { thumbnailPath: { endsWith: `/uploads/${safeDir}/${safeName}` } },
        { filePath: { endsWith: `/${safeName}` } },
        { thumbnailPath: { endsWith: `/${safeName}` } },
      ],
    },
    select: { id: true, mimeType: true, originalName: true, filePath: true, thumbnailPath: true },
  })

  if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const allowedDocument = await requireDocument(ctx, document.id)
  if (!allowedDocument) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const primaryPath = safeDir === 'thumbnails' ? document.thumbnailPath : document.filePath
    let storagePath = primaryPath
    let servingOriginalForMissingThumbnail = false
    let buffer: Buffer
    try {
      buffer = storagePath
        ? await readStoredFile(storagePath)
        : await readFile(safeName, safeDir)
    } catch (err) {
      if (safeDir !== 'thumbnails' || !document.filePath) throw err
      // Legacy local thumbnail paths from before R2 can point at files that no
      // longer exist on Render. Fall back to the original authenticated file so
      // old photo cards do not break with noisy ENOENT errors.
      storagePath = document.filePath
      buffer = await readStoredFile(storagePath)
      servingOriginalForMissingThumbnail = true
      console.warn(`[storage] thumbnail missing; serving original fallback documentId=${document.id} filename=${safeName}`)
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType(
          servingOriginalForMissingThumbnail ? (document.originalName || safeName) : safeName,
          servingOriginalForMissingThumbnail ? document.mimeType : safeDir === 'thumbnails' ? 'image/jpeg' : document.mimeType,
        ),
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': `inline; filename="${encodeURIComponent(document.originalName || safeName)}"`,
      },
    })
  } catch (err) {
    console.error('[storage] failed:', err)
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
