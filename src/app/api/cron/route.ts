import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { WORKFLOWS, SYSTEM_WORKFLOWS } from '@/lib/jobs/workflows'
import { timingSafeEqual } from 'node:crypto'
export const runtime = 'nodejs'
export const maxDuration = 60

// SECURITY: CRON_SECRET is always required. No dev bypass.
// Generate with: openssl rand -hex 32
async function authenticateCron(req: NextRequest): Promise<boolean> {
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret) {
    console.error('[cron] CRON_SECRET not set — cron endpoint disabled')
    return false
  }
  const providedSecret = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!providedSecret) return false
  // SECURITY: Use timingSafeEqual to prevent timing attacks
  try {
    const a = Buffer.from(providedSecret)
    const b = Buffer.from(expectedSecret)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// GET /api/cron?[workflow=name]&[contractorId=xxx]
// If no contractorId, runs for all contractors (system workflows only)
export async function GET(req: NextRequest) {
  if (!(await authenticateCron(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = new URL(req.url).searchParams
  const workflowName = sp.get('workflow') ?? 'all'
  const contractorId = sp.get('contractorId')

  const results: Array<{ workflow: string; contractorId: string | null; status: string; itemsProcessed: number; error?: string }> = []

  // System workflows (run once globally)
  const systemWorkflowNames = workflowName === 'all'
    ? Object.keys(SYSTEM_WORKFLOWS)
    : [workflowName].filter(n => SYSTEM_WORKFLOWS[n])

  for (const name of systemWorkflowNames) {
    try {
      const r = await SYSTEM_WORKFLOWS[name]()
      results.push({ workflow: name, contractorId: null, status: 'success', itemsProcessed: r.itemsProcessed })
    } catch (err) {
      results.push({ workflow: name, contractorId: null, status: 'error', itemsProcessed: 0, error: String(err) })
    }
  }

  // Tenant workflows
  const tenantWorkflows = workflowName === 'all'
    ? Object.keys(WORKFLOWS)
    : [workflowName].filter(n => WORKFLOWS[n])

  let contractors: string[] = []
  if (contractorId) {
    contractors = [contractorId]
  } else {
    const all = await db.contractor.findMany({ where: { status: 'active', deletedAt: null }, select: { id: true } })
    contractors = all.map(c => c.id)
  }

  for (const cid of contractors) {
    for (const name of tenantWorkflows) {
      try {
        const run = await db.cronRun.create({ data: { contractorId: cid, jobName: name, status: 'running' } })
        const result = await WORKFLOWS[name](cid)
        await db.cronRun.update({ where: { id: run.id }, data: { status: 'success', completedAt: new Date(), itemsProcessed: result.itemsProcessed, outputJson: JSON.stringify(result.output) } })
        results.push({ workflow: name, contractorId: cid, status: 'success', itemsProcessed: result.itemsProcessed })
      } catch (err) {
        results.push({ workflow: name, contractorId: cid, status: 'error', itemsProcessed: 0, error: String(err) })
      }
    }
  }

  return NextResponse.json({ results })
}
