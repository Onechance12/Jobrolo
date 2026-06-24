// =============================================================================
// Agent Job Queue — DB-persisted, survives restarts, concurrency-limited.
// =============================================================================
// SECURITY/RELIABILITY improvements:
//   - Concurrency limit (max 5 concurrent jobs per instance)
//   - Retry with exponential backoff (max 3 retries)
//   - Stale job recovery (5 min instead of 30 min)
//   - Job locking via atomic queued→processing transition
// =============================================================================

import { db } from '@/lib/db'

const MAX_CONCURRENT_JOBS = 5
const MAX_RETRIES = 3
const STALE_JOB_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes (was 30)

// Simple semaphore for concurrency control
let activeJobs = 0
const jobQueue: Array<() => void> = []

async function acquireSlot(): Promise<void> {
  if (activeJobs < MAX_CONCURRENT_JOBS) {
    activeJobs++
    return
  }
  return new Promise(resolve => {
    jobQueue.push(() => {
      activeJobs++
      resolve()
    })
  })
}

function releaseSlot(): void {
  activeJobs--
  if (jobQueue.length > 0 && activeJobs < MAX_CONCURRENT_JOBS) {
    const next = jobQueue.shift()
    if (next) next()
  }
}

export interface EnqueueOptions {
  contractorId: string
  userId?: string
  type: 'chat' | 'workspace_chat' | 'doc_analysis' | 'cron'
  input: Record<string, unknown>
  workspaceId?: string
  chatId?: string
  conversationId?: string
  priority?: number // 1 (high) to 10 (low)
}

export async function enqueueAgentJob(opts: EnqueueOptions) {
  const job = await db.agentJob.create({
    data: {
      contractorId: opts.contractorId,
      userId: opts.userId ?? null,
      type: opts.type,
      status: 'queued',
      priority: opts.priority ?? 5,
      inputJson: JSON.stringify(opts.input),
      workspaceId: opts.workspaceId ?? null,
      chatId: opts.chatId ?? null,
      conversationId: opts.conversationId ?? null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min TTL
    },
  })
  // Local/dev convenience only. In production/serverless, use the worker/cron path.
  const inline = process.env.AGENT_JOBS_INLINE === 'true' || (process.env.NODE_ENV !== 'production' && process.env.AGENT_JOBS_INLINE !== 'false')
  if (inline) {
    processJobById(job.id).catch(err => console.error(`[queue] job ${job.id} failed:`, err))
  }
  return job
}

export async function processJobById(jobId: string, retryCount = 0) {
  // Atomically transition queued → processing
  const updated = await db.agentJob.updateMany({
    where: { id: jobId, status: 'queued' },
    data: { status: 'processing', startedAt: new Date(), heartbeat: 'Starting...' },
  })
  if (updated.count === 0) return // already being processed or cancelled

  const job = await db.agentJob.findUnique({ where: { id: jobId } })
  if (!job) return

  // Acquire concurrency slot
  await acquireSlot()

  try {
    // Dispatch by job type
    if (job.type === 'doc_analysis') {
      const { processDocumentJob } = await import('@/lib/jobs/document-worker')
      await processDocumentJob(job)
    } else {
      // chat, workspace_chat, cron → agent worker
      const { processAgentJob } = await import('@/lib/jobs/worker')
      await processAgentJob(job)
    }
  } catch (err) {
    console.error(`[queue] job ${jobId} attempt ${retryCount + 1} failed:`, err)

    // Retry with exponential backoff if retries remain
    if (retryCount < MAX_RETRIES) {
      const backoffMs = Math.pow(2, retryCount) * 1000 // 1s, 2s, 4s
      console.log(`[queue] job ${jobId} retrying in ${backoffMs}ms (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`)

      // Reset job to queued for retry
      await db.agentJob.update({
        where: { id: jobId },
        data: {
          status: 'queued',
          heartbeat: `Retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})...`,
          error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        },
      }).catch(() => {})

      // Schedule retry
      setTimeout(() => {
        processJobById(jobId, retryCount + 1).catch(e =>
          console.error(`[queue] job ${jobId} retry failed:`, e)
        )
      }, backoffMs)
    } else {
      // Max retries exhausted — mark as failed
      await failJob(jobId, err instanceof Error ? err.message : String(err))
    }
  } finally {
    releaseSlot()
  }
}


export async function processQueuedAgentJobs(limit = 5) {
  const staleCutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS)
  await db.agentJob.updateMany({
    where: { status: 'processing', updatedAt: { lt: staleCutoff } },
    data: { status: 'queued', heartbeat: 'Recovered stale processing job for retry' },
  }).catch(() => null)

  const jobs = await db.agentJob.findMany({
    where: { status: 'queued' },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 25)),
    select: { id: true },
  })

  let processed = 0
  const results: Array<{ id: string; status: string; error?: string }> = []
  for (const job of jobs) {
    try {
      await processJobById(job.id)
      processed++
      results.push({ id: job.id, status: 'processed' })
    } catch (err) {
      results.push({ id: job.id, status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { processed, attempted: jobs.length, results }
}

// Heartbeat helper (called by worker during long operations)
export async function heartbeat(jobId: string, message: string) {
  try {
    await db.agentJob.update({ where: { id: jobId }, data: { heartbeat: message } })
  } catch {}
}

// Append a thinking step
export async function appendThinking(jobId: string, step: Record<string, unknown>) {
  try {
    const job = await db.agentJob.findUnique({ where: { id: jobId }, select: { thinkingJson: true } })
    const arr = job?.thinkingJson ? JSON.parse(job.thinkingJson) : []
    arr.push(step)
    await db.agentJob.update({ where: { id: jobId }, data: { thinkingJson: JSON.stringify(arr), heartbeat: step.text ?? 'Working...' } })
  } catch {}
}

export async function completeJob(jobId: string, output: Record<string, unknown>) {
  try {
    await db.agentJob.update({
      where: { id: jobId },
      data: {
        status: 'done',
        outputJson: JSON.stringify(output),
        completedAt: new Date(),
        heartbeat: 'Done',
      },
    })
  } catch {}
}

export async function failJob(jobId: string, error: string) {
  try {
    await db.agentJob.update({
      where: { id: jobId },
      data: { status: 'error', error: error.slice(0, 2000), completedAt: new Date() },
    })
  } catch {}
}

// Cleanup expired/stuck jobs (called by cron)
// SECURITY: Reduced from 30 min to 5 min — stale jobs should be caught faster
export async function cleanupStuckJobs() {
  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS)
  const result = await db.agentJob.updateMany({
    where: { status: 'processing', updatedAt: { lt: cutoff } },
    data: { status: 'error', error: 'Job timed out (no heartbeat for 5m)', completedAt: new Date() },
  })
  return result.count
}
