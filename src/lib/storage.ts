import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'

export type SavedStorageFile = {
  filename: string
  filePath: string
  mimeType: string
  size: number
  url: string
}

const PRIVATE_UPLOAD_ROOT = path.join(process.cwd(), 'storage', 'private', 'uploads')

type StorageProvider = 'local' | 's3' | 'r2'

export function storageProvider(): StorageProvider {
  const provider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase()
  if (provider === 'r2') return 'r2'
  if (provider === 's3') return 's3'
  return 'local'
}

let s3Client: S3Client | null = null
let storageConfigLogged = false
function logStorageConfigOnce() {
  if (storageConfigLogged) return
  storageConfigLogged = true
  const config = getStorageConfig()
  console.log(`[storage] provider=${config.provider} configured=${config.configured} bucket=${config.bucket ?? '(none)'} endpoint=${config.endpointHost ?? '(local)'}`)
}

function getS3Client() {
  if (s3Client) return s3Client
  logStorageConfigOnce()
  const provider = storageProvider()
  const region = provider === 'r2'
    ? (process.env.R2_REGION || process.env.S3_REGION || 'auto')
    : (process.env.S3_REGION || 'us-east-1')
  const endpoint = provider === 'r2'
    ? (process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined) || process.env.S3_ENDPOINT)
    : (process.env.S3_ENDPOINT || undefined)
  const accessKeyId = provider === 'r2'
    ? (process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID)
    : process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = provider === 'r2'
    ? (process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY)
    : process.env.S3_SECRET_ACCESS_KEY
  s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle: Boolean(endpoint && !endpoint.includes('amazonaws.com')),
    credentials: accessKeyId && secretAccessKey ? {
      accessKeyId,
      secretAccessKey,
    } : undefined,
  })
  return s3Client
}

function bucket() {
  const provider = storageProvider()
  const name = provider === 'r2' ? (process.env.R2_BUCKET || process.env.S3_BUCKET) : process.env.S3_BUCKET
  if (!name) throw new Error(provider === 'r2' ? 'R2_BUCKET is not configured' : 'S3_BUCKET is not configured')
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

function normalizeKeyPrefix(prefix?: string | null) {
  if (!prefix) return null
  return prefix
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.replace(/[^a-z0-9._=-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join('/')
}

function remoteKey(directory: string, filename: string, keyPrefix?: string | null) {
  const prefix = normalizeKeyPrefix(keyPrefix)
  if (prefix) return `${prefix}/${path.basename(filename)}`
  return keyFor(directory, filename)
}

function remotePath(provider: StorageProvider, bucketName: string, key: string) {
  return `${provider}://${bucketName}/${key}`
}

export function getStorageConfig() {
  const provider = storageProvider()
  const endpoint = provider === 'r2'
    ? (process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined) || process.env.S3_ENDPOINT || null)
    : (process.env.S3_ENDPOINT || null)
  const bucketName = provider === 'r2'
    ? (process.env.R2_BUCKET || process.env.S3_BUCKET || null)
    : provider === 's3'
      ? (process.env.S3_BUCKET || null)
      : null
  const region = provider === 'r2'
    ? (process.env.R2_REGION || process.env.S3_REGION || 'auto')
    : (process.env.S3_REGION || 'us-east-1')
  return {
    provider,
    bucket: bucketName,
    endpoint,
    endpointHost: endpoint ? (() => { try { return new URL(endpoint).host } catch { return endpoint } })() : null,
    region,
    localRoot: PRIVATE_UPLOAD_ROOT,
    configured: provider === 'local'
      ? true
      : Boolean(bucketName && endpoint && (
          provider === 'r2'
            ? (process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID) && (process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY)
            : process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        )),
  }
}

export async function saveFile(input: { buffer: Buffer; filename?: string; mimeType: string; directory?: string; keyPrefix?: string }): Promise<SavedStorageFile> {
  logStorageConfigOnce()
  const directory = directoryFromMime(input.mimeType, input.directory)
  const original = safeFilename(input.filename || `file-${Date.now()}`)
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${original}`

  const provider = storageProvider()
  if (provider === 's3' || provider === 'r2') {
    const bucketName = bucket()
    const key = remoteKey(directory, filename, input.keyPrefix)
    await getS3Client().send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: input.buffer,
      ContentType: input.mimeType,
      Metadata: { private: 'true', source: 'jobrolo' },
    }))
    console.log(`[storage] uploaded object provider=${provider} bucket=${bucketName} key=${key} size=${input.buffer.length}`)
    return { filename, filePath: remotePath(provider, bucketName, key), mimeType: input.mimeType, size: input.buffer.length, url: `/api/storage/${directory}/${filename}` }
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

function parseRemotePath(filePath: string): { provider: 's3' | 'r2'; bucket: string; key: string } | null {
  const match = filePath.match(/^(s3|r2):\/\/([^/]+)\/(.+)$/)
  if (!match) return null
  return { provider: match[1] as 's3' | 'r2', bucket: match[2], key: match[3] }
}

export async function readStoredFile(filePath: string): Promise<Buffer> {
  const parsed = parseRemotePath(filePath)
  if (parsed) {
    console.log(`[storage] read object provider=${parsed.provider} bucket=${parsed.bucket} key=${parsed.key}`)
    const res = await getS3Client().send(new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }))
    return await streamToBuffer(res.Body)
  }
  return await fs.readFile(filePath)
}

export async function readFile(filename: string, directory = 'docs'): Promise<Buffer> {
  const provider = storageProvider()
  if (provider === 's3' || provider === 'r2') {
    const res = await getS3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: keyFor(directory, filename) }))
    return await streamToBuffer(res.Body)
  }
  return fs.readFile(privateStoragePath(directory, filename))
}

export function isS3Path(filePath: string | null | undefined) {
  return Boolean(filePath?.startsWith('s3://'))
}

export function isRemoteStoragePath(filePath: string | null | undefined) {
  return Boolean(filePath?.startsWith('s3://') || filePath?.startsWith('r2://'))
}

export async function fileExists(filePath: string): Promise<boolean> {
  const parsed = parseRemotePath(filePath)
  try {
    if (parsed) {
      await getS3Client().send(new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }))
      return true
    }
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function deleteStoredFile(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false
  const parsed = parseRemotePath(filePath)
  try {
    if (parsed) {
      await getS3Client().send(new DeleteObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }))
      console.log(`[storage] deleted object provider=${parsed.provider} bucket=${parsed.bucket} key=${parsed.key}`)
      return true
    }
    await fs.unlink(filePath)
    return true
  } catch (err) {
    console.warn('[storage] delete skipped/failed:', err instanceof Error ? err.message : err)
    return false
  }
}

export async function storageHealthCheck() {
  const config = getStorageConfig()
  const testKey = `.health/jobrolo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`
  const body = Buffer.from(`jobrolo storage health ${new Date().toISOString()}`)
  if (config.provider === 'local') {
    const dir = path.join(PRIVATE_UPLOAD_ROOT, '.health')
    const localPath = path.join(dir, path.basename(testKey))
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(localPath, body)
    const readBack = await fs.readFile(localPath)
    await fs.unlink(localPath).catch(() => {})
    return { ...config, canWrite: true, canRead: readBack.equals(body), canDelete: true, testObjectKey: testKey, timestamp: new Date().toISOString() }
  }

  const bucketName = bucket()
  await getS3Client().send(new PutObjectCommand({ Bucket: bucketName, Key: testKey, Body: body, ContentType: 'text/plain' }))
  const read = await getS3Client().send(new GetObjectCommand({ Bucket: bucketName, Key: testKey }))
  const readBack = await streamToBuffer(read.Body)
  await getS3Client().send(new DeleteObjectCommand({ Bucket: bucketName, Key: testKey }))
  return { ...config, canWrite: true, canRead: readBack.equals(body), canDelete: true, testObjectKey: testKey, timestamp: new Date().toISOString() }
}
