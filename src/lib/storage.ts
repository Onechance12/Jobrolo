import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'

export type SavedStorageFile = {
  filename: string
  filePath: string
  mimeType: string
  size: number
  url: string
}

const PRIVATE_UPLOAD_ROOT = path.join(process.cwd(), 'storage', 'private', 'uploads')

function storageProvider() {
  return (process.env.STORAGE_PROVIDER || 'local').toLowerCase()
}

let s3Client: S3Client | null = null
function getS3Client() {
  if (s3Client) return s3Client
  const region = process.env.S3_REGION || 'us-east-1'
  const endpoint = process.env.S3_ENDPOINT || undefined
  s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle: Boolean(endpoint && !endpoint.includes('amazonaws.com')),
    credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined,
  })
  return s3Client
}

function bucket() {
  const name = process.env.S3_BUCKET
  if (!name) throw new Error('S3_BUCKET is not configured')
  return name
}

function safeFilename(name: string) {
  const ext = path.extname(name) || ''
  const stem = path.basename(name, ext).replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'file'
  return `${stem}${ext}`
}

function directoryFromMime(mimeType: string, directory?: string) {
  if (directory) return directory.replace(/[^a-z0-9_-]/gi, '') || 'docs'
  return mimeType.startsWith('image/') ? 'photos' : 'docs'
}

function keyFor(directory: string, filename: string) {
  const safeDir = directory.replace(/[^a-z0-9_-]/gi, '') || 'docs'
  return `uploads/${safeDir}/${path.basename(filename)}`
}

export async function saveFile(input: { buffer: Buffer; filename?: string; mimeType: string; directory?: string }): Promise<SavedStorageFile> {
  const directory = directoryFromMime(input.mimeType, input.directory)
  const original = safeFilename(input.filename || `file-${Date.now()}`)
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${original}`

  if (storageProvider() === 's3') {
    const key = keyFor(directory, filename)
    await getS3Client().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: input.buffer,
      ContentType: input.mimeType,
      Metadata: { private: 'true', source: 'jobrolo' },
    }))
    return { filename, filePath: `s3://${bucket()}/${key}`, mimeType: input.mimeType, size: input.buffer.length, url: `/api/storage/${directory}/${filename}` }
  }

  const dir = path.join(PRIVATE_UPLOAD_ROOT, directory)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, filename)
  await fs.writeFile(filePath, input.buffer)
  return { filename, filePath, mimeType: input.mimeType, size: input.buffer.length, url: `/api/storage/${directory}/${filename}` }
}

export function privateStoragePath(directory: string, filename: string) {
  const safeDir = directory.replace(/[^a-z0-9_-]/gi, '')
  const safeName = path.basename(filename)
  return path.join(PRIVATE_UPLOAD_ROOT, safeDir, safeName)
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) return stream
  if (stream instanceof Uint8Array) return Buffer.from(stream)
  if (stream instanceof Readable || typeof stream?.on === 'function') {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  if (typeof stream?.transformToByteArray === 'function') {
    const bytes = await stream.transformToByteArray()
    return Buffer.from(bytes)
  }
  throw new Error('Unsupported storage stream')
}

function parseS3Path(filePath: string): { bucket: string; key: string } | null {
  const match = filePath.match(/^s3:\/\/([^/]+)\/(.+)$/)
  if (!match) return null
  return { bucket: match[1], key: match[2] }
}

export async function readStoredFile(filePath: string): Promise<Buffer> {
  const parsed = parseS3Path(filePath)
  if (parsed) {
    const res = await getS3Client().send(new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }))
    return await streamToBuffer(res.Body)
  }
  return await fs.readFile(filePath)
}

export async function readFile(filename: string, directory = 'docs'): Promise<Buffer> {
  if (storageProvider() === 's3') {
    const res = await getS3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: keyFor(directory, filename) }))
    return await streamToBuffer(res.Body)
  }
  return fs.readFile(privateStoragePath(directory, filename))
}

export function isS3Path(filePath: string | null | undefined) {
  return Boolean(filePath?.startsWith('s3://'))
}
