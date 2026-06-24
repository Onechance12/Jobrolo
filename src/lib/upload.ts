import path from 'node:path'
import sharp from 'sharp'
import crypto from 'node:crypto'
import { saveFile as storageSaveFile, readStoredFile } from '@/lib/storage'

let heicDecode: any = null
async function getHeicDecode() {
  if (!heicDecode) {
    const m = await import('heic-decode')
    heicDecode = m.default || m
  }
  return heicDecode
}

export interface SavedFile {
  filename: string
  filePath: string
  thumbnailPath: string | null
  mimeType: string
  size: number
  needsConversion: boolean
  url: string
}

export async function ensureUploadDirs() {
  // Storage providers create directories/buckets lazily. Kept for compatibility.
  return true
}

// SECURITY: Convert private file paths to authenticated API URLs.
export function publicPathToUrl(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const match = normalized.match(/\/uploads\/(photos|docs|thumbnails|tts-cache)\/([^/?]+)$/)
  if (match) return `/api/storage/${match[1]}/${match[2]}`
  const basename = path.basename(normalized)
  const ext = path.extname(basename).toLowerCase()
  const dir = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'].includes(ext) ? 'photos' : 'docs'
  return `/api/storage/${dir}/${basename}`
}

function isHeic(filename: string, mimeType: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return ext === '.heic' || ext === '.heif' || mimeType === 'image/heic' || mimeType === 'image/heif'
}

function extensionFor(name: string, mimeType: string, isImage: boolean) {
  const ext = path.extname(name).toLowerCase()
  if (ext) return ext
  if (mimeType === 'application/pdf') return '.pdf'
  if (mimeType.includes('json')) return '.json'
  if (mimeType.includes('csv')) return '.csv'
  if (mimeType.includes('text')) return '.txt'
  return isImage ? '.jpg' : '.bin'
}

export async function saveUpload(file: { name: string; type: string; size: number; data: ArrayBuffer | Buffer }): Promise<SavedFile> {
  const isImage = file.type.startsWith('image/') || isHeic(file.name, file.type)
  const isHeicFile = isHeic(file.name, file.type)
  const buffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data)
  const ext = extensionFor(file.name, file.type, isImage)
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
  const directory = isImage ? 'photos' : 'docs'

  const stored = await storageSaveFile({
    buffer,
    filename,
    mimeType: file.type || 'application/octet-stream',
    directory,
  })

  let thumbnailPath: string | null = null
  if (isImage && !isHeicFile) {
    try {
      const thumbBuffer = await sharp(buffer)
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer()
      const thumbName = filename.replace(/\.[^.]+$/, '.jpg')
      const thumbStored = await storageSaveFile({
        buffer: thumbBuffer,
        filename: thumbName,
        mimeType: 'image/jpeg',
        directory: 'thumbnails',
      })
      thumbnailPath = thumbStored.filePath
    } catch (e) {
      console.error('[upload] thumb failed:', e)
    }
  }

  return {
    filename: stored.filename,
    filePath: stored.filePath,
    thumbnailPath,
    mimeType: stored.mimeType,
    size: stored.size,
    needsConversion: isHeicFile,
    url: stored.url,
  }
}

export async function convertHeicInBackground(filePath: string): Promise<{ newFilename: string; newFilePath: string; thumbnailPath: string | null; newUrl: string } | null> {
  try {
    const buffer = await readStoredFile(filePath)
    const decode = await getHeicDecode()
    const { width, height, data } = await decode({ buffer })
    const jpegBuffer = await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).jpeg({ quality: 85 }).toBuffer()
    const newFilename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`
    const stored = await storageSaveFile({ buffer: jpegBuffer, filename: newFilename, mimeType: 'image/jpeg', directory: 'photos' })

    let thumbnailPath: string | null = null
    try {
      const thumbBuffer = await sharp(jpegBuffer).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
      const thumbName = newFilename.replace(/\.[^.]+$/, '.jpg')
      const thumbStored = await storageSaveFile({ buffer: thumbBuffer, filename: thumbName, mimeType: 'image/jpeg', directory: 'thumbnails' })
      thumbnailPath = thumbStored.filePath
    } catch {}

    return { newFilename: stored.filename, newFilePath: stored.filePath, thumbnailPath, newUrl: stored.url }
  } catch (err) {
    console.error('[upload] HEIC bg conversion failed:', err)
    return null
  }
}

// SECURITY: All URLs point to /api/storage/ which requires authentication.
export function fileUrl(saved: Pick<SavedFile, 'filename'>): string {
  const ext = path.extname(saved.filename).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'].includes(ext)
    ? `/api/storage/photos/${saved.filename}`
    : `/api/storage/docs/${saved.filename}`
}

export function thumbnailUrl(saved: SavedFile): string | null {
  if (!saved.thumbnailPath) return null
  return `/api/storage/thumbnails/${path.basename(saved.thumbnailPath)}`
}
