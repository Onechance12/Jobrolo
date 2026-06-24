import { db } from '@/lib/db'

export type ReadinessSeverity = 'ok' | 'warning' | 'error'
export interface ReadinessCheck { key: string; label: string; status: ReadinessSeverity; detail: string; fix?: string }

function env(name: string) { return process.env[name] }
function present(name: string) { return Boolean(env(name)?.trim()) }
function isPostgres(url?: string) { return Boolean(url?.startsWith('postgres://') || url?.startsWith('postgresql://')) }

export async function getProductionReadinessReport() {
  const checks: ReadinessCheck[] = []
  const nodeEnv = process.env.NODE_ENV || 'development'
  const databaseUrl = env('DATABASE_URL') || ''
  const storageProvider = env('STORAGE_PROVIDER') || 'local'
  const commsEnabled = env('COMMUNICATIONS_ENABLED') === 'true'
  const appUrl = env('NEXT_PUBLIC_APP_URL') || ''

  checks.push({
    key: 'node_env',
    label: 'Node environment',
    status: nodeEnv === 'production' ? 'ok' : 'warning',
    detail: `NODE_ENV=${nodeEnv}`,
    fix: nodeEnv === 'production' ? undefined : 'Set NODE_ENV=production in real deployments.',
  })

  checks.push({
    key: 'database_provider',
    label: 'Database provider',
    status: isPostgres(databaseUrl) ? 'ok' : (nodeEnv === 'production' ? 'error' : 'warning'),
    detail: isPostgres(databaseUrl) ? 'DATABASE_URL uses Postgres.' : 'DATABASE_URL is not Postgres.',
    fix: isPostgres(databaseUrl) ? undefined : 'Use managed Postgres for production. SQLite is dev-only. Run Prisma migrations, not db push, before external beta.',
  })

  checks.push({
    key: 'session_secret',
    label: 'Session secret',
    status: present('SESSION_SECRET') && String(env('SESSION_SECRET')).length >= 32 ? 'ok' : 'error',
    detail: present('SESSION_SECRET') ? 'SESSION_SECRET is set.' : 'SESSION_SECRET is missing.',
    fix: 'Generate one with: openssl rand -hex 32',
  })

  checks.push({
    key: 'cron_secret',
    label: 'Cron secret',
    status: present('CRON_SECRET') && String(env('CRON_SECRET')).length >= 32 ? 'ok' : 'error',
    detail: present('CRON_SECRET') ? 'CRON_SECRET is set.' : 'CRON_SECRET is missing.',
    fix: 'Generate one with: openssl rand -hex 32 and pass it as Bearer token to /api/cron.',
  })

  checks.push({
    key: 'app_url',
    label: 'Public app URL',
    status: appUrl.startsWith('https://') || nodeEnv !== 'production' ? 'ok' : 'warning',
    detail: appUrl || 'NEXT_PUBLIC_APP_URL is not set.',
    fix: 'Set NEXT_PUBLIC_APP_URL to the public https:// URL for signatures, emails, and PDFs.',
  })

  checks.push({
    key: 'storage_provider',
    label: 'Private storage',
    status: storageProvider === 's3' ? requiredS3Configured() : (nodeEnv === 'production' ? 'warning' : 'ok'),
    detail: storageProvider === 's3' ? 'S3/R2 storage selected.' : 'Local private storage selected.',
    fix: storageProvider === 's3' ? 'Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and optional S3_ENDPOINT.' : 'Use S3/R2/Supabase Storage for serverless production; local storage is only safe on persistent disk deployments.',
  })

  checks.push({
    key: 'email_provider',
    label: 'Email delivery',
    status: emailReady() ? 'ok' : (commsEnabled ? 'warning' : 'warning'),
    detail: emailReady() ? `EMAIL_PROVIDER=${env('EMAIL_PROVIDER') || env('RESET_EMAIL_PROVIDER')}` : 'Email provider not fully configured.',
    fix: 'Configure EMAIL_PROVIDER=resend/sendgrid/postmark plus required API key and EMAIL_FROM.',
  })

  checks.push({
    key: 'sms_provider',
    label: 'SMS delivery',
    status: smsReady() ? 'ok' : 'warning',
    detail: smsReady() ? `SMS_PROVIDER=${env('SMS_PROVIDER')}` : 'SMS provider not fully configured.',
    fix: 'Configure SMS_PROVIDER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER when SMS is needed.',
  })

  checks.push({
    key: 'property_research',
    label: 'Active property research provider',
    status: process.env.PROPERTY_RESEARCH_ENABLED === '1' ? (present('PROPERTY_RESEARCH_WEBHOOK_URL') ? 'ok' : 'warning') : 'warning',
    detail: process.env.PROPERTY_RESEARCH_ENABLED === '1' ? 'Active property research is enabled.' : 'Active property research provider is disabled; Jobrolo will use cached/imported property memory only.',
    fix: 'Set PROPERTY_RESEARCH_ENABLED=1 and PROPERTY_RESEARCH_WEBHOOK_URL when you connect a property data provider/webhook. Keep disabled until data terms/compliance are ready.',
  })

  checks.push({
    key: 'communications_enabled',
    label: 'Communication sending',
    status: commsEnabled ? 'ok' : 'warning',
    detail: commsEnabled ? 'COMMUNICATIONS_ENABLED=true' : 'Outbound delivery is queued/skipped unless explicitly enabled.',
    fix: 'Set COMMUNICATIONS_ENABLED=true only after provider credentials and legal opt-in flows are ready.',
  })


  checks.push({
    key: 'job_worker',
    label: 'Durable AI job worker',
    status: nodeEnv === 'production' && process.env.AGENT_JOBS_INLINE !== 'false' ? 'warning' : 'ok',
    detail: `AGENT_JOBS_INLINE=${process.env.AGENT_JOBS_INLINE || '(default)'}`,
    fix: 'Set AGENT_JOBS_INLINE=false in production and run /api/cron?workflow=agent_jobs from a worker/cron process.',
  })

  checks.push({
    key: 'distributed_rate_limit',
    label: 'Distributed rate limiting',
    status: nodeEnv === 'production' && !process.env.REDIS_URL && !process.env.UPSTASH_REDIS_REST_URL ? 'warning' : 'ok',
    detail: process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL ? 'Redis/Upstash configured.' : 'No Redis/Upstash configured.',
    fix: 'Use Redis/Upstash for production rate limits. In-memory limits are only single-instance protection.',
  })

  checks.push({
    key: 'demo_guard',
    label: 'Demo guard',
    status: process.env.JOBROLO_DEMO === '1' && nodeEnv === 'production' ? 'error' : 'ok',
    detail: `JOBROLO_DEMO=${process.env.JOBROLO_DEMO || '0'}`,
    fix: 'Never run JOBROLO_DEMO=1 in production.',
  })

  try {
    await db.$queryRaw`SELECT 1`
    checks.push({ key: 'database_connection', label: 'Database connection', status: 'ok', detail: 'Database responded.' })
  } catch (err) {
    checks.push({ key: 'database_connection', label: 'Database connection', status: 'error', detail: err instanceof Error ? err.message : String(err), fix: 'Verify DATABASE_URL and run Prisma migrations/db push.' })
  }

  const errors = checks.filter(c => c.status === 'error').length
  const warnings = checks.filter(c => c.status === 'warning').length
  return { status: errors ? 'blocked' : warnings ? 'needs_attention' : 'ready', errors, warnings, checks }
}

function requiredS3Configured(): ReadinessSeverity {
  return ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].every(present) ? 'ok' : 'error'
}
function emailReady() {
  const provider = env('EMAIL_PROVIDER') || env('RESET_EMAIL_PROVIDER')
  if (!provider || provider === 'console' || provider === 'dev') return false
  if (provider === 'resend') return present('RESEND_API_KEY') && present('EMAIL_FROM')
  if (provider === 'sendgrid') return present('SENDGRID_API_KEY') && present('EMAIL_FROM')
  if (provider === 'postmark') return present('POSTMARK_SERVER_TOKEN') && present('EMAIL_FROM')
  return false
}
function smsReady() {
  const provider = env('SMS_PROVIDER')
  if (provider !== 'twilio') return false
  return present('TWILIO_ACCOUNT_SID') && present('TWILIO_AUTH_TOKEN') && present('TWILIO_FROM_NUMBER')
}
