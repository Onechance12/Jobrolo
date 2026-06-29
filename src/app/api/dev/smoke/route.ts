import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDeployInfo } from '@/lib/deploy-info'
import { requireDevBridge } from '@/lib/dev-bridge'

export const runtime = 'nodejs'

function configured(name: string) {
  return Boolean(process.env[name]?.trim())
}

export async function GET(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const warnings: string[] = []
  let database = 'ok'

  const [
    contractorCount,
    userCount,
    customerCount,
    projectCount,
    documentCount,
    pendingActionCount,
    codyNoteCount,
    processingDocumentCount,
    queuedJobCount,
  ] = await Promise.all([
    db.contractor.count(),
    db.user.count(),
    db.customer.count(),
    db.project.count(),
    db.document.count(),
    db.actionRequest.count({ where: { status: { in: ['pending', 'needs_approval', 'routed'] } } }),
    db.inboxItem.count({ where: { type: { in: ['tester_feedback', 'cody_observation'] }, status: { in: ['unread', 'read'] } } }),
    db.document.count({ where: { status: { in: ['pending', 'processing', 'analyzing', 'needs_ocr'] } } }),
    db.agentJob.count({ where: { status: { in: ['queued', 'processing'] } } }),
  ]).catch(error => {
    database = 'error'
    warnings.push(error instanceof Error ? error.message : 'Database query failed.')
    return [0, 0, 0, 0, 0, 0, 0, 0, 0] as const
  })

  if (!configured('CODY_BRIDGE_TOKEN')) warnings.push('CODY_BRIDGE_TOKEN is not configured.')
  if (!configured('DATABASE_URL')) warnings.push('DATABASE_URL is not configured.')
  if (!configured('OPENAI_API_KEY') && !configured('LLM_API_KEY')) warnings.push('No OpenAI-compatible API key is configured.')
  if (processingDocumentCount > 0) warnings.push(`${processingDocumentCount} documents are currently pending/processing analysis.`)
  if (queuedJobCount > 0) warnings.push(`${queuedJobCount} agent jobs are queued/processing.`)

  return NextResponse.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    deploy: getDeployInfo(),
    checks: {
      database,
      storageProvider: process.env.STORAGE_PROVIDER || 'local',
      llmProvider: process.env.LLM_PROVIDER || 'z-ai',
      openAiConfigured: configured('OPENAI_API_KEY') || configured('LLM_API_KEY'),
      webSearchConfigured: configured('OPENAI_API_KEY') || configured('LLM_API_KEY'),
      codyBridgeConfigured: configured('CODY_BRIDGE_TOKEN'),
      ocrProvider: process.env.OCR_PROVIDER || 'none',
    },
    counts: {
      contractors: contractorCount,
      users: userCount,
      customers: customerCount,
      projects: projectCount,
      documents: documentCount,
      pendingActions: pendingActionCount,
      openCodyNotes: codyNoteCount,
      processingDocuments: processingDocumentCount,
      activeAgentJobs: queuedJobCount,
    },
    warnings,
  })
}
