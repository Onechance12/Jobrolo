#!/usr/bin/env node
import fs from 'node:fs'
const requiredProd = ['SESSION_SECRET', 'CRON_SECRET', 'DATABASE_URL', 'NEXT_PUBLIC_APP_URL']
const warnings = []
const errors = []
const env = process.env.NODE_ENV || 'development'

for (const key of requiredProd) {
  if (env === 'production' && !process.env[key]) errors.push(`${key} is required in production`)
}

const databaseUrl = process.env.DATABASE_URL || ''
if (env === 'production' && !databaseUrl.startsWith('postgres')) errors.push('DATABASE_URL must be Postgres in production. SQLite is dev-only.')
if (env === 'production' && process.env.JOBROLO_DEMO === '1') errors.push('JOBROLO_DEMO=1 must never run in production')
if (env === 'production' && !process.env.REDIS_URL && !process.env.UPSTASH_REDIS_REST_URL) warnings.push('Redis/Upstash is recommended for production rate limiting and job coordination.')
if (env === 'production' && process.env.AGENT_JOBS_INLINE !== 'false') warnings.push('Set AGENT_JOBS_INLINE=false in production and run the cron/worker process for durable jobs.')


if (env === 'production') {
  const migrationRoot = 'prisma/migrations'
  const hasSqlMigration = fs.existsSync(migrationRoot) && fs.readdirSync(migrationRoot).some(dir => fs.existsSync(`${migrationRoot}/${dir}/migration.sql`))
  if (!hasSqlMigration) warnings.push('No Prisma migration.sql found. Generate and commit a Postgres baseline migration before production deploy.')
  if (fs.existsSync(migrationRoot)) {
    const creates = new Map()
    for (const dir of fs.readdirSync(migrationRoot)) {
      const file = `${migrationRoot}/${dir}/migration.sql`
      if (!fs.existsSync(file)) continue
      const sql = fs.readFileSync(file, 'utf8')
      for (const match of sql.matchAll(/CREATE\s+TABLE\s+"([^"]+)"/gi)) {
        const table = match[1]
        const seen = creates.get(table) || []
        seen.push(dir)
        creates.set(table, seen)
      }
    }
    for (const [table, dirs] of creates.entries()) {
      if (dirs.length > 1) errors.push(`Duplicate CREATE TABLE "${table}" appears in migrations: ${dirs.join(', ')}`)
    }
  }
}

if ((process.env.STORAGE_PROVIDER || 'local') === 's3') {
  for (const key of ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    if (!process.env[key]) errors.push(`${key} is required when STORAGE_PROVIDER=s3`)
  }
}

if ((process.env.STORAGE_PROVIDER || 'local') === 'r2') {
  for (const key of ['R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    if (!process.env[key] && !process.env[key.replace('R2_', 'S3_')]) errors.push(`${key} is required when STORAGE_PROVIDER=r2`)
  }
  if (!process.env.R2_ENDPOINT && !process.env.R2_ACCOUNT_ID && !process.env.S3_ENDPOINT) {
    errors.push('R2_ENDPOINT or R2_ACCOUNT_ID is required when STORAGE_PROVIDER=r2')
  }
}

if (process.env.PROPERTY_RESEARCH_ENABLED === '1' && !process.env.PROPERTY_RESEARCH_WEBHOOK_URL) {
  warnings.push('PROPERTY_RESEARCH_ENABLED=1 but PROPERTY_RESEARCH_WEBHOOK_URL is not set. Active lookups will fall back to cached/imported property memory.')
}

if (process.env.COMMUNICATIONS_ENABLED === 'true') {
  const email = process.env.EMAIL_PROVIDER || process.env.RESET_EMAIL_PROVIDER
  if (email === 'resend' && !process.env.RESEND_API_KEY) errors.push('RESEND_API_KEY required for EMAIL_PROVIDER=resend')
  if (email === 'sendgrid' && !process.env.SENDGRID_API_KEY) errors.push('SENDGRID_API_KEY required for EMAIL_PROVIDER=sendgrid')
  if (email === 'postmark' && !process.env.POSTMARK_SERVER_TOKEN) errors.push('POSTMARK_SERVER_TOKEN required for EMAIL_PROVIDER=postmark')
  if (email && email !== 'console' && !process.env.EMAIL_FROM) warnings.push('EMAIL_FROM should be set for outbound email')
  if (process.env.SMS_PROVIDER === 'twilio') {
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']) {
      if (!process.env[key]) errors.push(`${key} required for SMS_PROVIDER=twilio`)
    }
  }
}

if (warnings.length) {
  console.warn('\nJobrolo preflight warnings:')
  for (const warning of warnings) console.warn(`- ${warning}`)
}
if (errors.length) {
  console.error('\nJobrolo preflight errors:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log('Jobrolo preflight passed')
