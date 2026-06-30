import { NextRequest, NextResponse } from 'next/server'
import { checkBodySize } from '@/lib/security/body-size'
import { db } from '@/lib/db'
import { requireDevBridge, safeText } from '@/lib/dev-bridge'
import { enqueueAgentJob } from '@/lib/jobs/queue'
import { sanitizeUserInput } from '@/lib/security/prompt-defense'
import { assertDocumentsBelongToTenant, normalizeIdList } from '@/lib/security/agent-execution'
import { buildSkillRoutingContext } from '@/lib/skills/context'
import { selectSkills } from '@/lib/skills/select-skill'
import { orchestrateSkills } from '@/lib/skills/orchestrate-skills'
import { hasLocalTruthMutationIntent, resolveLocalTruthRoute } from '@/lib/truth/resolve-local-truth'
import { compileLocalAction } from '@/lib/truth/compile-local-action'

export const runtime = 'nodejs'

type ChatTestMode = 'dry_run' | 'local_only' | 'live'

function boolValue(value: unknown) {
  return value === true || value === 'true'
}

function modeValue(value: unknown): ChatTestMode {
  const text = safeText(value, 50)
  if (text === 'live' || text === 'local_only' || text === 'dry_run') return text
  return 'dry_run'
}

async function resolveChatTestUser(contractorId: string, userId?: string) {
  if (userId) {
    return db.user.findFirst({
      where: { id: userId, contractorId, status: 'active', deletedAt: null },
      select: { id: true, name: true, email: true, role: true },
    })
  }

  return db.user.findFirst({
    where: {
      contractorId,
      status: 'active',
      deletedAt: null,
      role: { in: ['owner', 'admin', 'manager', 'project_manager'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true, role: true },
  })
}

async function resolveConversationTarget(contractorId: string, conversationId?: string, message?: string) {
  if (conversationId) {
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, contractorId },
      select: { id: true, title: true },
    })
    if (!conversation) return null
    return conversation
  }

  return db.conversation.create({
    data: {
      contractorId,
      title: `[Codex test] ${safeText(message, 60) || 'Jobrolo prompt'}`,
    },
    select: { id: true, title: true },
  })
}

async function resolveWorkspaceChatTarget(contractorId: string, workspaceId: string, chatId: string) {
  return db.workspaceChat.findFirst({
    where: {
      id: chatId,
      workspaceId,
      workspace: { contractorId },
    },
    select: {
      id: true,
      title: true,
      chatType: true,
      workspaceId: true,
      workspace: { select: { id: true, name: true, type: true } },
    },
  })
}

export async function POST(req: NextRequest) {
  const unauthorized = requireDevBridge(req)
  if (unauthorized) return unauthorized

  const sizeErr = checkBodySize(req, 128 * 1024)
  if (sizeErr) return sizeErr

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected JSON object.' }, { status: 400 })
  }

  const record = body as Record<string, unknown>
  const mode = modeValue(record.mode)
  const confirm = boolValue(record.confirm)
  const message = safeText(record.message, 8000)
  const displayMessage = safeText(record.displayMessage, 8000) || message
  const contractorId = safeText(record.contractorId, 200)
  const userId = safeText(record.userId, 200)
  const conversationId = safeText(record.conversationId, 200)
  const workspaceId = safeText(record.workspaceId, 200)
  const chatId = safeText(record.chatId, 200)
  const channelType = safeText(record.channelType, 100)
  const role = safeText(record.role, 100)
  const activeCustomerId = safeText(record.activeCustomerId, 200)
  const activeProjectId = safeText(record.activeProjectId, 200)
  const documentIds = normalizeIdList(record.documentIds)

  if (!message) return NextResponse.json({ error: 'message is required.' }, { status: 400 })
  if ((workspaceId && !chatId) || (chatId && !workspaceId)) {
    return NextResponse.json({ error: 'workspaceId and chatId must be supplied together.' }, { status: 400 })
  }

  const localTruthRoute = resolveLocalTruthRoute(message, { activeProjectId: activeProjectId || null })
  const localAction = compileLocalAction(message, {
    activeCustomerId: activeCustomerId || null,
    activeProjectId: activeProjectId || null,
    documentIds,
  })
  const skillContext = buildSkillRoutingContext({
    latestText: message,
    channelType,
    role,
    activeCustomerId: activeCustomerId || null,
    activeProjectId: activeProjectId || null,
    activeWorkspaceId: workspaceId || null,
  })
  const skillSelections = selectSkills(skillContext)
  const orchestration = orchestrateSkills(skillContext, { highComplexity: boolValue(record.highComplexity) })
  const mutationIntent = hasLocalTruthMutationIntent(message)

  const dryRunPacket = {
    status: 'ok',
    dryRun: mode !== 'live',
    mode,
    note: mode === 'live'
      ? 'Live mode requested. Requires confirm=true and a valid contractor/user target before enqueueing.'
      : 'Dry-run/local-only route inspection. This does not create messages, call OpenAI, execute tools, or mutate records.',
    input: {
      message,
      contractorId: contractorId || null,
      userId: userId || null,
      conversationId: conversationId || null,
      workspaceId: workspaceId || null,
      chatId: chatId || null,
      documentIds,
    },
    localTruth: localTruthRoute
      ? {
          canAvoidAiForInitialRead: true,
          routeId: localTruthRoute.id,
          reason: localTruthRoute.reason,
          confidence: localTruthRoute.confidence,
          toolCall: localTruthRoute.toolCall,
        }
      : {
          canAvoidAiForInitialRead: false,
          reason: mutationIntent
            ? localAction
              ? 'Mutation-like request has a deterministic local action candidate. Execution still must go through the trusted tool/approval path.'
              : 'Mutation-like request must go through the full trusted agent/tool/approval path.'
            : 'No deterministic local-truth read route matched this prompt.',
        },
    localAction: localAction
      ? {
          canAvoidAiForRouting: true,
          id: localAction.id,
          status: localAction.status,
          reason: localAction.reason,
          confidence: localAction.confidence,
          requiresApproval: localAction.requiresApproval,
          toolCall: localAction.toolCall ?? null,
          missingContext: localAction.missingContext ?? [],
          blockedTools: localAction.blockedTools ?? [],
          userPrompt: localAction.userPrompt ?? null,
        }
      : {
          canAvoidAiForRouting: false,
          reason: mutationIntent
            ? 'No deterministic local action compiler route matched this mutation-like prompt.'
            : 'Prompt is not a local action candidate.',
        },
    skillRouting: {
      selected: skillSelections.map(selection => ({
        id: selection.skill.id,
        title: selection.skill.title ?? selection.skill.name,
        confidence: selection.confidence,
        reason: selection.reason,
      })),
      orchestration,
    },
    expectedRuntimePath: localTruthRoute
      ? 'local_truth_read_before_ai'
      : mutationIntent
        ? 'agent_loop_with_tools_and_approval'
        : 'agent_loop_ai_reasoning',
  }

  if (mode !== 'live') return NextResponse.json(dryRunPacket)
  if (!confirm) {
    return NextResponse.json({
      ...dryRunPacket,
      status: 'blocked',
      error: 'Live chat-test requires confirm=true. Re-run with --live --confirm if you intentionally want to write a prompt into Jobrolo.',
    }, { status: 409 })
  }
  if (!contractorId) return NextResponse.json({ error: 'contractorId is required for live mode.' }, { status: 400 })

  const contractor = await db.contractor.findFirst({
    where: { id: contractorId, status: 'active', deletedAt: null },
    select: { id: true, name: true, company: true },
  })
  if (!contractor) return NextResponse.json({ error: 'Contractor not found or inactive.' }, { status: 404 })

  const user = await resolveChatTestUser(contractorId, userId || undefined)
  if (!user) return NextResponse.json({ error: 'No active owner/admin/manager user found for live chat-test.' }, { status: 404 })

  try {
    await assertDocumentsBelongToTenant(contractorId, documentIds)
  } catch {
    return NextResponse.json({ error: 'One or more documents are not available for this contractor.' }, { status: 404 })
  }

  const sanitized = sanitizeUserInput(message)
  const sanitizedDisplay = sanitizeUserInput(displayMessage)

  let job
  let target: Record<string, unknown>
  if (workspaceId && chatId) {
    const workspaceChat = await resolveWorkspaceChatTarget(contractorId, workspaceId, chatId)
    if (!workspaceChat) return NextResponse.json({ error: 'Workspace chat not found for contractor.' }, { status: 404 })
    job = await enqueueAgentJob({
      contractorId,
      userId: user.id,
      type: 'workspace_chat',
      input: {
        message: sanitized.text,
        displayMessage: sanitizedDisplay.text,
        documentIds,
        history: [],
        workspaceId,
        chatId,
        source: 'codex_dev_bridge',
      },
      workspaceId,
      chatId,
      priority: 5,
    })
    target = {
      kind: 'workspace_chat',
      workspaceId,
      workspaceName: workspaceChat.workspace.name,
      chatId,
      chatTitle: workspaceChat.title,
      chatType: workspaceChat.chatType,
    }
  } else {
    const conversation = await resolveConversationTarget(contractorId, conversationId || undefined, message)
    if (!conversation) return NextResponse.json({ error: 'Conversation not found for contractor.' }, { status: 404 })
    job = await enqueueAgentJob({
      contractorId,
      userId: user.id,
      type: 'chat',
      input: {
        message: sanitized.text,
        displayMessage: sanitizedDisplay.text,
        conversationId: conversation.id,
        businessContext: { source: 'codex_dev_bridge' },
        documentIds,
        history: [],
      },
      conversationId: conversation.id,
      priority: 5,
    })
    target = {
      kind: 'conversation',
      conversationId: conversation.id,
      conversationTitle: conversation.title,
    }
  }

  await db.auditLog.create({
    data: {
      contractorId,
      userId: user.id,
      actor: `dev:cody_bridge:${user.email}`,
      action: 'codex_chat_test',
      resourceType: String(target.kind),
      resourceId: String(target.chatId ?? target.conversationId ?? job.id),
      detail: `Codex dev bridge enqueued prompt: ${sanitizedDisplay.text.slice(0, 120)}`,
      metadataJson: JSON.stringify({ jobId: job.id, target, documentIds, warnings: sanitized.warnings }),
    },
  }).catch(() => null)

  return NextResponse.json({
    status: 'queued',
    live: true,
    warning: 'This wrote a user prompt into Jobrolo and enqueued the normal agent worker. It may call OpenAI and may fail while provider quota is exhausted.',
    jobId: job.id,
    contractor,
    actorUser: user,
    target,
    routePreview: dryRunPacket,
  })
}
