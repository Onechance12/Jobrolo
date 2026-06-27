// =============================================================================
// Agent Job Worker — processes a single AgentJob, runs the agent loop,
// persists outputs and actions. Stateless: any instance can process any job.
// =============================================================================

import { db } from '@/lib/db'
import { type ChatMessage } from '@/lib/ai'
import { buildCommandCenterPrompt, buildChannelPrompt } from '@/lib/prompts'
import { runAgentLoop, type AgentIteration } from '@/lib/agent-loop'
import { executeActions } from '@/lib/actions'
import { heartbeat, appendThinking, completeJob, failJob, isJobCancelled } from '@/lib/jobs/queue'
import { wrapUntrusted, sanitizeAIOutput, validateAction } from '@/lib/security/prompt-defense'
import type { AiAction, ChannelType, WorkspaceInfo, MessageAttachment } from '@/lib/types'
import { assertDocumentsBelongToTenant, normalizeIdList, resolveJobExecutionContext } from '@/lib/security/agent-execution'
import { normalizeRole } from '@/lib/security/permissions'

interface AgentJobRow {
  id: string
  contractorId: string
  type: string
  inputJson: string
  workspaceId: string | null
  chatId: string | null
  conversationId: string | null
  userId: string | null
}

const INTERNAL_WORK_PATTERNS = [
  /You said "/i,
  /MUST call/i,
  /Common recovery examples/i,
  /Respond as JSON only/i,
  /Tool results:/i,
  /\[UPLOADED DOCUMENTS/i,
  /UNTRUSTED_CONTENT/i,
  /correct tool or include the correct action/i,
  /narrated operational work/i,
]

function humanToolLabel(name: string) {
  const labels: Record<string, string> = {
    list_customers: 'saved clients',
    get_customer_file: 'customer file',
    get_document_content: 'uploaded document',
    get_upload_status: 'upload status',
    get_recent_uploads: 'recent uploads',
    link_document_to_customer: 'file attachment',
    create_project_for_customer: 'project/job',
    create_project_chat: 'chat setup',
    invite_user_to_chat: 'chat invite',
    get_contractor_profile: 'company profile',
    update_contractor_profile: 'company profile',
    research_contractor_website: 'company research',
    research_property_now: 'property research',
    resolve_field_location: 'field location',
    start_field_inspection_lead: 'field inspection lead',
    create_canvassing_lead_at_location: 'field lead',
    review_price_sheet_items: 'price sheet rows',
    import_price_sheet_items: 'price sheet import',
    decide_pending_action_requests: 'pending approval',
    decide_action_request: 'approval',
  }
  return labels[name] ?? name.replace(/_/g, ' ')
}

function safeWorkText(iter: AgentIteration) {
  const toolNames = [...new Set(iter.toolCalls.map(tc => humanToolLabel(tc.name)))]
  if (toolNames.length > 0) return `Working on ${toolNames.join(', ')}…`
  const text = String(iter.text ?? '').trim()
  if (!text || INTERNAL_WORK_PATTERNS.some(pattern => pattern.test(text))) {
    return 'Checking the right saved workflow…'
  }
  return text.length > 140 ? `${text.slice(0, 137)}…` : text
}

function safeToolResultSummary(result: { name: string; success: boolean; data: unknown; error?: string }) {
  if (!result.success) return 'Needs attention'
  const data = result.data as Record<string, any> | null
  if (data?.message && typeof data.message === 'string') return data.message.slice(0, 100)
  if (data?.card?.cardType) return `Prepared ${String(data.card.cardType).replace(/_/g, ' ')}`
  if (data?.cardType) return `Prepared ${String(data.cardType).replace(/_/g, ' ')}`
  return 'Done'
}

function isPlaceholderUrl(value: string) {
  return /(?:yourdomain\.com|api\.storage\.url)/i.test(value)
}

function isUsableFileUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!value.trim() || isPlaceholderUrl(value)) return false
  return value.startsWith('/api/') || value.startsWith('http://') || value.startsWith('https://')
}

function hostnameLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function canonicalAttachmentKey(attachment: MessageAttachment) {
  if (attachment.type !== 'link') return attachment.documentId || attachment.url
  try {
    const url = new URL(attachment.url)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'msclkid'].includes(key.toLowerCase())) {
        url.searchParams.delete(key)
      }
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return attachment.url
  }
}

function isWebSourceObject(obj: Record<string, any>, url: string, documentId?: string) {
  if (documentId) return false
  if (!/^https?:\/\//i.test(url)) return false
  const hasWebSourceShape = typeof obj.title === 'string'
    || typeof obj.snippet === 'string'
    || typeof obj.notes === 'string'
    || typeof obj.source === 'string'
    || typeof obj.rating === 'string'
    || typeof obj.reviewCount === 'string'
  const mimeType = String(obj.mimeType ?? '')
  const fileType = String(obj.fileType ?? obj.documentType ?? '')
  return hasWebSourceShape && !mimeType && !fileType && !obj.thumbnailUrl
}

function cleanSourceName(value: unknown, fallback?: string) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || /^url$/i.test(text)) return fallback
  return text
}

function attachmentFromToolObject(obj: Record<string, any>): MessageAttachment | null {
  const url = obj.url ?? obj.fileUrl
  if (!isUsableFileUrl(url)) return null
  const documentId = String(obj.documentId ?? obj.id ?? '').trim() || undefined
  if (isWebSourceObject(obj, url, documentId)) {
    const host = hostnameLabel(url)
    const source = cleanSourceName(obj.source, host)
    const name = cleanSourceName(obj.title, cleanSourceName(obj.name, source ?? host ?? 'Web source')) ?? 'Web source'
    const description = String(obj.snippet ?? obj.notes ?? obj.description ?? '').trim() || undefined
    return {
      type: 'link',
      name,
      url,
      mimeType: 'text/html',
      description,
      source,
    }
  }
  const name = String(obj.name ?? obj.originalName ?? obj.filename ?? 'Saved file')
  const mimeType = String(obj.mimeType ?? '')
  const fileType = String(obj.fileType ?? obj.documentType ?? '')
  const thumbnailUrl = isUsableFileUrl(obj.thumbnailUrl) ? obj.thumbnailUrl : undefined
  const isImage = fileType === 'photo' || mimeType.startsWith('image/') || Boolean(thumbnailUrl)
  const status = String(obj.status ?? obj.documentStatus ?? '')
  return {
    type: isImage ? 'image' : 'file',
    name,
    url,
    thumbnailUrl,
    mimeType: mimeType || (isImage ? 'image/jpeg' : 'application/octet-stream'),
    size: typeof obj.size === 'number' ? obj.size : undefined,
    documentId,
    documentStatus: ['queued', 'processing', 'reviewed', 'failed', 'needs_ocr', 'pending_review'].includes(status) ? status as MessageAttachment['documentStatus'] : undefined,
    documentType: fileType || undefined,
    documentSummary: typeof obj.aiSummary === 'string' ? obj.aiSummary : typeof obj.summary === 'string' ? obj.summary : undefined,
  }
}

function collectAttachmentsFromValue(value: unknown, out: Map<string, MessageAttachment>, depth = 0) {
  if (!value || depth > 6) return
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentsFromValue(item, out, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const obj = value as Record<string, any>
  const attachment = attachmentFromToolObject(obj)
  if (attachment) out.set(canonicalAttachmentKey(attachment), attachment)
  for (const child of Object.values(obj)) collectAttachmentsFromValue(child, out, depth + 1)
}

function deriveAttachmentsFromToolResults(iterations: Array<{ toolResults?: Array<{ data: unknown }> }>): MessageAttachment[] {
  const out = new Map<string, MessageAttachment>()
  for (const iter of iterations) {
    for (const result of iter.toolResults ?? []) collectAttachmentsFromValue(result.data, out)
  }
  return [...out.values()].slice(0, 12)
}

function normalizeModelAttachment(value: unknown): MessageAttachment | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, any>
  if (!isUsableFileUrl(obj.url)) return null
  const type = obj.type === 'image' || obj.type === 'file' || obj.type === 'link'
    ? obj.type
    : (String(obj.mimeType ?? '').startsWith('image/') || obj.thumbnailUrl ? 'image' : 'file')
  const status = String(obj.documentStatus ?? '')
  return {
    type,
    name: String(obj.name ?? obj.title ?? obj.originalName ?? obj.filename ?? (type === 'link' ? hostnameLabel(String(obj.url)) ?? 'Web source' : 'Saved file')),
    url: obj.url,
    thumbnailUrl: isUsableFileUrl(obj.thumbnailUrl) ? obj.thumbnailUrl : undefined,
    mimeType: String(obj.mimeType ?? (type === 'image' ? 'image/jpeg' : type === 'link' ? 'text/html' : 'application/octet-stream')),
    size: typeof obj.size === 'number' ? obj.size : undefined,
    documentId: obj.documentId ? String(obj.documentId) : undefined,
    documentStatus: ['queued', 'processing', 'reviewed', 'failed', 'needs_ocr', 'pending_review'].includes(status) ? status as MessageAttachment['documentStatus'] : undefined,
    documentType: obj.documentType,
    documentSummary: obj.documentSummary,
    documentCategory: obj.documentCategory,
    documentExtractedData: obj.documentExtractedData,
    description: typeof obj.description === 'string' ? obj.description : typeof obj.snippet === 'string' ? obj.snippet : undefined,
    source: cleanSourceName(obj.source, type === 'link' ? hostnameLabel(String(obj.url)) : undefined),
  }
}

function mergeAttachments(primary: unknown[], derived: MessageAttachment[]): MessageAttachment[] {
  const out = new Map<string, MessageAttachment>()
  for (const value of primary) {
    const attachment = normalizeModelAttachment(value)
    if (attachment) out.set(canonicalAttachmentKey(attachment), attachment)
  }
  for (const attachment of derived) {
    if (isUsableFileUrl(attachment.url)) out.set(canonicalAttachmentKey(attachment), attachment)
  }
  return [...out.values()]
}

function deriveApprovalCardFromToolResults(iterations: Array<{ toolResults?: Array<{ data: unknown }> }>) {
  for (const iter of iterations) {
    for (const result of iter.toolResults ?? []) {
      const data = result.data as Record<string, unknown> | null
      if (!data?.approvalRequired || !data.actionRequestId) continue
      return {
        contextType: 'approval_request',
        contextData: {
          cardType: 'approval_request',
          actionRequestId: data.actionRequestId,
          id: data.actionRequestId,
          type: 'tool_approval',
          title: data.title ?? 'Approval needed',
          summary: data.summary ?? 'Review and approve before Jobrolo runs this action.',
          status: data.status ?? 'needs_approval',
          toolName: data.toolName,
          approvalDetails: data.approvalDetails,
          payload: {
            actionRequestId: data.actionRequestId,
            toolName: data.toolName,
            approvalDetails: data.approvalDetails,
          },
        },
      }
    }
  }
  return null
}

function deriveCardFromToolResults(iterations: Array<{ toolResults?: Array<{ data: unknown }> }>) {
  for (const iter of iterations) {
    for (const result of iter.toolResults ?? []) {
      const data = result.data as Record<string, unknown> | null
      const nested = data?.card
      if (nested && typeof nested === 'object' && (nested as Record<string, unknown>).cardType) {
        const card = nested as Record<string, unknown>
        return {
          contextType: String(card.cardType),
          contextData: card,
        }
      }
      if (data?.cardType) {
        return {
          contextType: String(data.cardType),
          contextData: data,
        }
      }
    }
  }
  return null
}

export async function processAgentJob(job: AgentJobRow) {
  const input = JSON.parse(job.inputJson) as {
    message: string
    displayMessage?: string
    conversationId?: string
    businessContext?: string
    documentIds?: string[]
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
    workspaceId?: string
    chatId?: string
  }
  input.documentIds = normalizeIdList(input.documentIds)
  const displayMessage = input.displayMessage?.trim() || input.message

  // Heartbeat loop — show the user what we're doing
  let hbCount = 0
  const hbTexts = [
    'Working on it…',
    'Searching records…',
    'Checking documents…',
    'Analyzing data…',
    'Almost there…',
  ]
  const hbInterval = setInterval(() => {
    heartbeat(job.id, hbTexts[hbCount++ % hbTexts.length]).catch(() => {})
  }, 1500)

  // Job timeout — 90 seconds max (prevents stuck jobs in production)
  const jobTimeout = setTimeout(() => {
    clearInterval(hbInterval)
    console.error(`[worker] job ${job.id} timed out after 90s`)
    failJob(job.id, 'Job timed out after 90 seconds')
    db.agentJob.update({
      where: { id: job.id },
      data: { status: 'error', error: 'Job timed out after 90 seconds', completedAt: new Date() },
    }).catch(() => {})
  }, 90_000)

  try {
    const execCtx = await resolveJobExecutionContext(job)
    const contractor = execCtx.contractor
    const actorRole = normalizeRole(execCtx.user?.role)

    // 1. Persist user message + find/create conversation
    let conversationId = input.conversationId ?? job.conversationId
    if (!conversationId) {
      const convo = await db.conversation.create({ data: { contractorId: contractor.id, title: displayMessage.slice(0, 50) } })
      conversationId = convo.id
    }
    const conversation = await db.conversation.findFirst({ where: { id: conversationId, contractorId: job.contractorId } })
    if (!conversation) {
      throw new Error('Conversation not found')
    }

    if (job.workspaceId && job.chatId) {
      const chat = await db.workspaceChat.findFirst({
        where: { id: job.chatId, workspace: { id: job.workspaceId, contractorId: job.contractorId } },
        select: { id: true },
      })
      if (!chat) throw new Error('Workspace/chat not found')
      await db.workspaceMessage.create({ data: { chatId: job.chatId, role: 'user', content: displayMessage, attachments: input.documentIds?.length ? JSON.stringify(input.documentIds) : null } })
      await db.workspaceChat.update({ where: { id: job.chatId }, data: { lastActivity: new Date() } })
    } else {
      await db.message.create({ data: { conversationId: conversation.id, role: 'user', content: displayMessage, attachments: input.documentIds?.length ? JSON.stringify(input.documentIds) : null } })
    }

    // 2. Build system prompt
    let systemPrompt: string
    let channelType: ChannelType | undefined
    if (job.workspaceId && job.chatId) {
      const ws = await db.workspace.findFirst({
        where: { id: job.workspaceId, contractorId: job.contractorId },
        include: {
          project: { include: { customer: { select: { id: true, name: true, phone: true, email: true } } } },
          customer: { select: { id: true, name: true, phone: true, email: true, address: true } },
          subcontractor: { select: { id: true, name: true, company: true, specialty: true, phone: true } },
        },
      })
      const chat = await db.workspaceChat.findFirst({
        where: { id: job.chatId, workspace: { id: job.workspaceId, contractorId: job.contractorId } },
      })
      if (!ws || !chat) throw new Error('Workspace/chat not found')
      channelType = chat.chatType as ChannelType

      const recentMemory = await db.workspaceMemory.findMany({ where: { workspaceId: job.workspaceId }, orderBy: { createdAt: 'desc' }, take: 30 })
      const otherChats = await db.workspaceChat.findMany({ where: { workspaceId: job.workspaceId, NOT: { id: job.chatId } }, select: { id: true, chatType: true } })
      let crossActivity: Array<{ chatType: string; role: string; content: string; createdAt: string }> = []
      if (otherChats.length > 0) {
        const msgs = await Promise.all(otherChats.map(async oc => {
          const m = await db.workspaceMessage.findMany({ where: { chatId: oc.id }, orderBy: { createdAt: 'desc' }, take: 3, select: { role: true, content: true, createdAt: true } })
          return m.map(x => ({ chatType: oc.chatType, role: x.role, content: x.content, createdAt: x.createdAt.toISOString() }))
        }))
        crossActivity = msgs.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 15)
      }
      let tasks: Array<{ id: string; title: string; status: string; priority: string }> = []
      if (ws.projectId) tasks = await db.task.findMany({ where: { projectId: ws.projectId }, orderBy: [{ status: 'asc' }, { priority: 'desc' }], take: 20, select: { id: true, title: true, status: true, priority: true } })

      const workspaceInfo: WorkspaceInfo = {
        id: ws.id, name: ws.name, type: ws.type as WorkspaceInfo['type'],
        description: ws.description, color: ws.color, status: ws.status,
        projectId: ws.projectId, customerId: ws.customerId, subcontractorId: ws.subcontractorId, supplierId: ws.supplierId,
        chats: [], chatCount: 0,
        project: ws.project ? { id: ws.project.id, title: ws.project.title, status: ws.project.status, priority: ws.project.priority, address: ws.project.address, value: ws.project.value, customer: ws.project.customer } : null,
        customer: ws.customer, subcontractor: ws.subcontractor,
      }
      systemPrompt = buildChannelPrompt({
        channelType,
        workspace: workspaceInfo,
        contractorName: contractor.company ?? contractor.name,
        recentMemory: recentMemory.map(m => ({ category: m.category, content: m.content, createdAt: m.createdAt.toISOString() })),
        crossChannelActivity: crossActivity,
        tasks,
      })
    } else {
      const workspaces = await db.workspace.findMany({
        where: { contractorId: contractor.id, status: 'active' },
        include: { chats: { select: { id: true, chatType: true }, orderBy: { chatType: 'asc' } } },
      })
      systemPrompt = buildCommandCenterPrompt({
        contractorName: contractor.company ?? contractor.name,
        workspaceMap: workspaces.map(w => ({ id: w.id, name: w.name, type: w.type, chats: w.chats.map(c => ({ chatType: c.chatType, id: c.id })) })),
      })
    }

    // 3. Build messages array — user input is wrapped as untrusted content
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }]
    if (input.businessContext && !job.workspaceId) {
      messages.push({ role: 'system', content: `CURRENT BUSINESS CONTEXT:\n${input.businessContext}` })
    }
    for (const h of (input.history ?? []).slice(-20)) {
      messages.push({ role: h.role, content: h.content })
    }

    // If documents were uploaded, inject their IDs into the user message so the
    // AI knows to call get_document_content to read them. Without this, the AI
    // sees "[Uploaded Files: filename.pdf]" but has no document ID to look up.
    let userMessage = input.message
    if (input.documentIds && input.documentIds.length > 0) {
      // Fetch document metadata so we can tell the AI what each doc is
      const validDocs = await assertDocumentsBelongToTenant(job.contractorId, input.documentIds)
      if (validDocs.length > 0) {
        const docList = validDocs.map(d => `  - documentId: "${d!.id}" | filename: "${d!.originalName}" | type: ${d!.fileType} | status: ${d!.status}${d!.aiSummary ? ` | summary: ${d!.aiSummary.slice(0, 100)}` : ''}`).join('\n')
        userMessage = `${input.message}

[UPLOADED DOCUMENTS — call get_document_content with the documentId to read each one before responding:]
${docList}

IMPORTANT: You MUST call get_document_content for each uploaded document before answering. Do not ask the user for information that is in the documents — read the documents first.`
      }
    }

    // Wrap user message as untrusted content (defense-in-depth vs prompt injection)
    messages.push({ role: 'user', content: wrapUntrusted(userMessage, 'user_message') })

    // 4. Run agent loop
    const loopResult = await runAgentLoop({
      messages,
      contractorId: contractor.id,
      workspaceId: job.workspaceId ?? undefined,
      chatId: job.chatId ?? undefined,
      channelType,
      documentIds: input.documentIds,  // pass uploaded doc IDs so create_customer can auto-link
      userId: execCtx.user?.id,
      userRole: actorRole,
      trustedDirectExecution: Boolean(execCtx.user),
      maxIterations: 4,
      isCancelled: () => isJobCancelled(job.id),
      onIteration: (iter) => {
        if (!iter.final) {
          appendThinking(job.id, {
            text: safeWorkText(iter),
            toolCalls: iter.toolCalls.map(tc => ({ name: tc.name, args: tc.args })),
            toolResults: iter.toolResults?.map(r => ({ name: r.name, success: r.success, summary: safeToolResultSummary(r) })),
          }).catch(() => {})
        }
      },
    })

    const finalText = sanitizeAIOutput(loopResult.final.text || '(no response)')
    const approvalCard = deriveApprovalCardFromToolResults(loopResult.iterations)
    const toolCard = deriveCardFromToolResults(loopResult.iterations)
    const finalContextType = loopResult.final.contextType ?? approvalCard?.contextType ?? toolCard?.contextType ?? null
    const finalContextData = loopResult.final.contextData ?? approvalCard?.contextData ?? toolCard?.contextData ?? null
    let finalActions = (loopResult.final.actions ?? []) as AiAction[]

    if (await isJobCancelled(job.id)) {
      console.log(`[worker] job ${job.id} cancelled before persisting assistant output/actions`)
      return
    }

    // 5. Validate every action before executing
    finalActions = finalActions.filter(a => {
      const err = validateAction(a)
      if (err) { console.warn(`[worker] rejected invalid action:`, err, a); return false }
      return true
    })

    const finalAttachments = mergeAttachments(loopResult.final.attachments ?? [], deriveAttachmentsFromToolResults(loopResult.iterations))
    let actionResults: Array<{ action: string; status: string; detail: string; targetChatType?: string }> = []

    // Execute actions when we're in a workspace chat context.
    // The old code required the user to literally mention the workspace name in
    // their message — that was completely broken. When you're already IN a workspace
    // chat, the workspace context is implicit and actions should always execute.
    if (finalActions.length > 0 && job.workspaceId) {
      if (await isJobCancelled(job.id)) {
        console.log(`[worker] job ${job.id} cancelled before executing final actions`)
        return
      }
      const ws = await db.workspace.findFirst({
        where: { id: job.workspaceId, contractorId: contractor.id },
        include: { chats: { select: { id: true, chatType: true } } },
      })
      if (ws) {
        const sourceChatType = (ws.chats.find(c => c.id === job.chatId)?.chatType ?? 'main') as ChannelType
        actionResults = await executeActions(finalActions, {
          workspaceId: ws.id,
          sourceChatId: job.chatId ?? ws.chats[0]?.id,
          sourceChatType,
          contractorId: contractor.id,
          userId: job.userId ?? undefined,
        })
      }
    }

    // 6. Persist assistant message
    if (job.workspaceId && job.chatId) {
      await db.workspaceMessage.create({
        data: {
          chatId: job.chatId, role: 'assistant', content: finalText,
          contextType: finalContextType,
          contextData: finalContextData ? JSON.stringify(finalContextData) : null,
          actionResults: actionResults.length ? JSON.stringify(actionResults) : null,
          attachments: finalAttachments.length ? JSON.stringify(finalAttachments) : null,
        },
      })
      await db.workspaceChat.update({ where: { id: job.chatId }, data: { lastActivity: new Date() } })
    } else {
      await db.message.create({
        data: {
          conversationId: conversation.id, role: 'assistant', content: finalText,
          contextType: finalContextType,
          contextData: finalContextData ? JSON.stringify(finalContextData) : null,
          actionResults: actionResults.length ? JSON.stringify(actionResults) : null,
          attachments: finalAttachments.length ? JSON.stringify(finalAttachments) : null,
        },
      })
      if ((!conversation.title || conversation.title === 'New Chat' || conversation.title === 'New private chat' || conversation.title === 'Welcome to Jobrolo') && input.message) {
        await db.conversation.update({ where: { id: conversation.id }, data: { title: input.message.slice(0, 60), updatedAt: new Date() } })
      } else {
        await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
      }
    }

    clearInterval(hbInterval)
    clearTimeout(jobTimeout)
    completeJob(job.id, {
      text: finalText,
      actionResults,
      attachments: finalAttachments,
      contextType: finalContextType,
      contextData: finalContextData,
      conversationId: conversation.id,
    })
  } catch (err) {
    clearInterval(hbInterval)
    clearTimeout(jobTimeout)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[worker] job ${job.id} failed:`, err)
    failJob(job.id, msg)
  }
}
