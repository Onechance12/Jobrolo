import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDeployInfo } from '@/lib/deploy-info'
import { requireContext } from '@/lib/security/context'
export const runtime = 'nodejs'

// PUBLIC health check — returns only basic status, no internal config details.
// Detailed health (providers, job counts, demo mode) requires authentication.
export async function GET(req: NextRequest) {
  // Try to authenticate — if authenticated, return detailed health
  const ctx = await requireContext(req).catch(() => null)

  if (!ctx) {
    // Public response — minimal info only
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      deploy: getDeployInfo(),
    })
  }

  // Authenticated response — detailed health for operators
  const checks: Record<string, string> = {}
  let allOk = true

  try {
    await db.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch {
    checks.database = 'error'
    allOk = false
  }

  checks.ai_provider = process.env.LLM_PROVIDER || 'z-ai'
  checks.storage = process.env.STORAGE_PROVIDER || 'local'
  checks.communications = process.env.COMMUNICATIONS_ENABLED === 'true' ? 'enabled' : 'queued/skipped'
  checks.email_provider = process.env.EMAIL_PROVIDER || process.env.RESET_EMAIL_PROVIDER || 'console'
  checks.sms_provider = process.env.SMS_PROVIDER || 'console'
  checks.ocr_provider = process.env.OCR_PROVIDER || 'none'
  checks.demo_mode = process.env.JOBROLO_DEMO === '1' ? 'ON' : 'off'

  try {
    const queued = await db.agentJob.count({ where: { status: 'queued' } })
    const processing = await db.agentJob.count({ where: { status: 'processing' } })
    checks.jobs_queued = String(queued)
    checks.jobs_processing = String(processing)
  } catch { checks.jobs = 'unavailable' }

  return NextResponse.json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    deploy: getDeployInfo(),
    checks,
  }, { status: allOk ? 200 : 503 })
}
