#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const execute = process.argv.includes('--execute')
const limitArg = process.argv.find(a => a.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : 500

const bucket = process.env.R2_BUCKET || process.env.S3_BUCKET
const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : process.env.S3_ENDPOINT)
const region = process.env.R2_REGION || process.env.S3_REGION || 'auto'
const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY

if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  console.error('Missing R2 config. Required: R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ENDPOINT or R2_ACCOUNT_ID.')
  process.exit(1)
}

const prisma = new PrismaClient()
const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
})

function isLocalPath(value) {
  return Boolean(value && !value.startsWith('s3://') && !value.startsWith('r2://') && !value.startsWith('/api/storage/'))
}

function safePart(value, fallback = 'unknown') {
  return String(value || fallback)
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.replace(/[^a-z0-9._=-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join('-') || fallback
}

function objectBase(doc) {
  const base = `contractors/${doc.contractorId}`
  if (doc.projectId) return `${base}/projects/${doc.projectId}/documents/${doc.id}`
  if (doc.customerId) return `${base}/customers/${doc.customerId}/documents/${doc.id}`
  return `${base}/documents/${doc.id}`
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function uploadLocal(filePath, key, contentType) {
  const body = await fs.readFile(filePath)
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    Metadata: { private: 'true', source: 'jobrolo-migration' },
  }))
  return body.length
}

const stats = { scanned: 0, present: 0, missing: 0, uploaded: 0, skipped: 0, errors: 0 }

try {
  const docs = await prisma.document.findMany({
    where: {
      OR: [
        { filePath: { not: { startsWith: 'r2://' } } },
        { thumbnailPath: { not: null } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: Number.isFinite(limit) ? limit : 500,
  })

  console.log(`[storage-migrate] mode=${execute ? 'execute' : 'dry-run'} docs=${docs.length} bucket=${bucket} endpoint=${new URL(endpoint).host}`)

  for (const doc of docs) {
    stats.scanned++
    const updates = {}
    const base = objectBase(doc)

    if (isLocalPath(doc.filePath)) {
      const originalExists = await exists(doc.filePath)
      const filename = safePart(doc.filename || path.basename(doc.filePath), 'file')
      const key = `${base}/original/${filename}`
      if (!originalExists) {
        stats.missing++
        console.warn(`[storage-migrate] missing original doc=${doc.id} path=${doc.filePath}`)
      } else if (execute) {
        await uploadLocal(doc.filePath, key, doc.mimeType)
        updates.filePath = `r2://${bucket}/${key}`
        stats.uploaded++
        console.log(`[storage-migrate] uploaded original doc=${doc.id} key=${key}`)
      } else {
        stats.present++
        console.log(`[storage-migrate] would upload original doc=${doc.id} key=${key}`)
      }
    } else {
      stats.skipped++
    }

    if (isLocalPath(doc.thumbnailPath)) {
      const thumbExists = await exists(doc.thumbnailPath)
      const thumbName = safePart(path.basename(doc.thumbnailPath), 'thumbnail.jpg')
      const thumbKey = `${base}/thumb/${thumbName}`
      if (!thumbExists) {
        stats.missing++
        console.warn(`[storage-migrate] missing thumbnail doc=${doc.id} path=${doc.thumbnailPath}`)
      } else if (execute) {
        await uploadLocal(doc.thumbnailPath, thumbKey, 'image/jpeg')
        updates.thumbnailPath = `r2://${bucket}/${thumbKey}`
        stats.uploaded++
        console.log(`[storage-migrate] uploaded thumbnail doc=${doc.id} key=${thumbKey}`)
      } else {
        stats.present++
        console.log(`[storage-migrate] would upload thumbnail doc=${doc.id} key=${thumbKey}`)
      }
    }

    if (execute && Object.keys(updates).length > 0) {
      await prisma.document.update({ where: { id: doc.id }, data: updates })
    }
  }

  console.log('[storage-migrate] summary', stats)
  if (!execute) console.log('[storage-migrate] dry-run only. Re-run with --execute to upload and update Document rows. Local files are never deleted by this script.')
} catch (err) {
  stats.errors++
  console.error('[storage-migrate] failed:', err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
