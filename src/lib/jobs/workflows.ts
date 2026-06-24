// =============================================================================
// Autonomous Workflows — proactive agents that run on a schedule.
// Each workflow is idempotent, logs to CronRun, respects tenant scoping.
// =============================================================================

import { db } from '@/lib/db'

export interface WorkflowResult {
  itemsProcessed: number
  output: Record<string, unknown>
  error?: string
}

// ---------------------------------------------------------------------------
// Stalled Job Detector — finds active projects with no activity in 7+ days,
// creates a task and posts to management channel.
// ---------------------------------------------------------------------------

export async function detectStalledJobs(contractorId: string): Promise<WorkflowResult> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const stalled = await db.project.findMany({
    where: {
      contractorId,
      status: 'active',
      updatedAt: { lt: cutoff },
    },
    include: { workspace: { include: { chats: { where: { chatType: 'management' } } } } },
  })

  let processed = 0
  for (const project of stalled) {
    if (!project.workspace) continue
    const mgmtChat = project.workspace.chats[0]
    if (!mgmtChat) continue

    // Check if we already have a stalled notification in the last 7 days
    const existing = await db.workspaceMessage.findFirst({
      where: {
        chatId: mgmtChat.id,
        content: { contains: `STALLED: ${project.title}` },
        createdAt: { gt: cutoff },
      },
    })
    if (existing) continue // already notified

    await db.workspaceMessage.create({
      data: {
        chatId: mgmtChat.id,
        role: 'assistant',
        content: `⚠️ STALLED: ${project.title} hasn't had activity in 7+ days. Last updated ${project.updatedAt.toDateString()}. Consider following up with the customer or crew.`,
      },
    })
    await db.workspaceChat.update({ where: { id: mgmtChat.id }, data: { lastActivity: new Date() } })

    // Create a task if there's a project
    await db.task.create({
      data: {
        projectId: project.id,
        title: `Follow up on stalled project: ${project.title}`,
        priority: 'high',
        status: 'open',
      },
    })

    processed++
  }

  return {
    itemsProcessed: processed,
    output: { stalledCount: stalled.length, notified: processed },
  }
}

// ---------------------------------------------------------------------------
// Lead Follow-up — finds customers created 24h+ ago with no follow-up scheduled
// ---------------------------------------------------------------------------

export async function detectColdLeads(contractorId: string): Promise<WorkflowResult> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const leads = await db.customer.findMany({
    where: {
      contractorId,
      createdAt: { lt: cutoff },
      followUps: { none: {} },
    },
    take: 20,
  })

  let processed = 0
  for (const lead of leads) {
    await db.followUp.create({
      data: {
        customerId: lead.id,
        type: 'call',
        reason: 'New lead — no follow-up scheduled yet',
        status: 'pending',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isAiSuggested: true,
      },
    })
    processed++
  }

  return {
    itemsProcessed: processed,
    output: { coldLeadCount: leads.length, scheduled: processed },
  }
}

// ---------------------------------------------------------------------------
// Stuck Agent Jobs — requeue or fail jobs that have been processing too long
// ---------------------------------------------------------------------------

export async function cleanupStuckJobs(): Promise<WorkflowResult> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000)
  const result = await db.agentJob.updateMany({
    where: { status: 'processing', updatedAt: { lt: cutoff } },
    data: { status: 'error', error: 'Job timed out (no heartbeat for 30m)', completedAt: new Date() },
  })
  return { itemsProcessed: result.count, output: { cleaned: result.count } }
}


// ---------------------------------------------------------------------------
// Communication Outbox Dispatcher — sends queued email/SMS messages
// ---------------------------------------------------------------------------

export async function dispatchNotificationOutbox(): Promise<WorkflowResult> {
  const { dispatchQueuedCommunications } = await import('@/lib/communications')
  const result = await dispatchQueuedCommunications(100)
  return { itemsProcessed: result.processed, output: result }
}


export async function processAgentJobs(): Promise<WorkflowResult> {
  const { processQueuedAgentJobs } = await import('@/lib/jobs/queue')
  const result = await processQueuedAgentJobs(Number(process.env.AGENT_JOB_WORKER_BATCH_SIZE || 5))
  return { itemsProcessed: result.processed, output: result }
}

// ---------------------------------------------------------------------------
// Workflow registry
// ---------------------------------------------------------------------------

export const WORKFLOWS: Record<string, (contractorId: string) => Promise<WorkflowResult>> = {
  stalled_job_detector: detectStalledJobs,
  lead_followup: detectColdLeads,
  operations_radar: async (contractorId: string) => {
    const { runOperationsRadar } = await import('@/lib/radar')
    const result = await runOperationsRadar(contractorId)
    return { itemsProcessed: result.handled, output: { detected: result.detected, handled: result.handled, escalated: result.escalated } }
  },
}

export const SYSTEM_WORKFLOWS: Record<string, () => Promise<WorkflowResult>> = {
  cleanup_stuck_jobs: cleanupStuckJobs,
  dispatch_notifications: dispatchNotificationOutbox,
  agent_jobs: processAgentJobs,
}
