import { db } from './db'
import { type ChatMessage } from './ai'
import { buildCommandCenterPrompt, buildChannelPrompt } from './prompts'
import { runAgentLoop } from './agent-loop'
import { executeActions } from './actions'
import type { AiAction, ChannelType, WorkspaceInfo } from './types'

interface ChatJob {
  id: string; status: 'processing' | 'done' | 'error'
  thinking: Array<{ text: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }>; toolResults?: Array<{ name: string; success: boolean; summary: string }> }>
  heartbeat: string
  result?: {
    text: string
    actionResults: Array<{ action: string; status: string; detail: string; targetChatType?: string }>
    attachments: Array<{ type: string; name: string; url: string; thumbnailUrl?: string; documentId?: string }>
    contextType?: string | null
    contextData?: unknown | null
    conversationId: string
  }
  error?: string
  createdAt: number
}

const jobs = new Map<string, ChatJob>()
setInterval(() => { const now = Date.now(); for (const [id, job] of jobs) if (now - job.createdAt > 600000) jobs.delete(id) }, 60000)

function sanitizeGeneratedStorageUrls(text: string) {
  return text
    .replace(/https?:\/\/yourdomain\.com(\/api\/storage\/[^\s)\]}]+)/gi, '$1')
    .replace(/https?:\/\/api(\/storage\/[^\s)\]}]+)/gi, '/api$1')
}

function safeThinkingText(text: string, toolNames: string[] = []) {
  if (toolNames.length > 0) return `Working on ${[...new Set(toolNames.map(n => n.replace(/_/g, ' ')))].join(', ')}…`
  const clean = String(text ?? '').trim()
  if (!clean || /You said "|MUST call|Common recovery examples|Respond as JSON only|Tool results:|\[UPLOADED DOCUMENTS|UNTRUSTED_CONTENT|narrated operational work/i.test(clean)) {
    return 'Checking the right saved workflow…'
  }
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean
}

function collectImageAttachmentsFromToolData(value: unknown): Array<{ type: string; name: string; url: string; thumbnailUrl?: string; documentId?: string }> {
  const found: Array<{ type: string; name: string; url: string; thumbnailUrl?: string; documentId?: string }> = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const record = node as Record<string, unknown>
    const fileType = String(record.fileType ?? record.type ?? '').toLowerCase()
    const mimeType = String(record.mimeType ?? '').toLowerCase()
    const url = typeof record.url === 'string' ? sanitizeGeneratedStorageUrls(record.url) : null
    const isImage = fileType === 'photo' || fileType === 'image' || mimeType.startsWith('image/')
    if (isImage && url && url.startsWith('/api/storage/')) {
      found.push({
        type: 'image',
        name: String(record.originalName ?? record.filename ?? record.name ?? 'Uploaded photo'),
        url,
        thumbnailUrl: typeof record.thumbnailUrl === 'string' ? sanitizeGeneratedStorageUrls(record.thumbnailUrl) : undefined,
        documentId: typeof record.id === 'string' ? record.id : typeof record.documentId === 'string' ? record.documentId : undefined,
      })
    }
    for (const child of Object.values(record)) visit(child)
  }
  visit(value)
  const seen = new Set<string>()
  return found.filter(a => {
    const key = a.documentId || a.url
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 20)
}

function deriveCardFromToolResults(iterations: Array<{ toolResults?: Array<{ data: unknown }> }>) {
  for (const iter of iterations) {
    for (const result of iter.toolResults ?? []) {
      const data = result.data as Record<string, unknown> | null
      const nested = data?.card
      if (nested && typeof nested === 'object' && (nested as Record<string, unknown>).cardType) {
        const card = nested as Record<string, unknown>
        return { contextType: String(card.cardType), contextData: card }
      }
      if (data?.cardType) return { contextType: String(data.cardType), contextData: data }
    }
  }
  return null
}

export function createJob(): string {
  const id = crypto.randomUUID()
  jobs.set(id, { id, status: 'processing', thinking: [], heartbeat: 'Starting...', createdAt: Date.now() })
  return id
}

export function getJob(jobId: string): ChatJob | null { return jobs.get(jobId) || null }

export async function processJob(jobId: string, opts: {
  message: string; displayMessage?: string; conversationId?: string; businessContext?: string; documentIds?: string[]
  history?: Array<{ role: 'user' | 'assistant'; content: string }>; workspaceId?: string; chatId?: string
}): Promise<void> {
  const job = jobs.get(jobId); if (!job) return
  if (process.env.JOBROLO_ENABLE_LEGACY_CHAT_JOB !== '1') {
    job.status = 'error'
    job.error = 'Legacy in-memory chat processor is disabled. Use the database-backed agent job queue.'
    job.heartbeat = 'Legacy processor disabled'
    console.error('[chat-job] legacy in-memory processor disabled; use enqueueAgentJob/processAgentJob')
    return
  }
  const { message, displayMessage, conversationId, businessContext, documentIds = [], history = [], workspaceId, chatId } = opts
  const visibleMessage = displayMessage?.trim() || message
  let heartbeatCount = 0
  const heartbeatTexts = ['Thinking...', 'Processing...', 'Gathering data...', 'Almost there...', 'Working on it...']
  const hb = setInterval(() => { const j = jobs.get(jobId); if (!j || j.status !== 'processing') { clearInterval(hb); return } j.heartbeat = heartbeatTexts[heartbeatCount++ % heartbeatTexts.length] }, 2000)

  try {
    const contractor = await db.contractor.findFirst(); if (!contractor) throw new Error('No contractor')
    let conversation = conversationId ? await db.conversation.findUnique({ where: { id: conversationId } }) : null
    if (!conversation) conversation = await db.conversation.create({ data: { contractorId: contractor.id, title: visibleMessage.slice(0, 50) } })

    if (workspaceId && chatId) {
      await db.workspaceMessage.create({ data: { chatId, role: 'user', content: visibleMessage, attachments: documentIds.length ? JSON.stringify(documentIds) : null } })
      await db.workspaceChat.update({ where: { id: chatId }, data: { lastActivity: new Date() } })
    } else {
      await db.message.create({ data: { conversationId: conversation.id, role: 'user', content: visibleMessage, attachments: documentIds.length ? JSON.stringify(documentIds) : null } })
    }

    let systemPrompt: string
    if (workspaceId && chatId) {
      const ws = await db.workspace.findUnique({ where: { id: workspaceId }, include: { project: { include: { customer: { select: { id: true, name: true, phone: true, email: true } } } }, customer: { select: { id: true, name: true, phone: true, email: true, address: true } }, subcontractor: { select: { id: true, name: true, company: true, specialty: true, phone: true } } } })
      const chat = await db.workspaceChat.findFirst({ where: { id: chatId, workspaceId } })
      if (!ws || !chat) throw new Error('Workspace/chat not found')
      const recentMemory = await db.workspaceMemory.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 30 })
      const otherChats = await db.workspaceChat.findMany({ where: { workspaceId, NOT: { id: chatId } }, select: { id: true, chatType: true } })
      let crossActivity: Array<{ chatType: string; role: string; content: string; createdAt: string }> = []
      if (otherChats.length > 0) { const msgs = await Promise.all(otherChats.map(async oc => { const m = await db.workspaceMessage.findMany({ where: { chatId: oc.id }, orderBy: { createdAt: 'desc' }, take: 3, select: { role: true, content: true, createdAt: true } }); return m.map(x => ({ chatType: oc.chatType, role: x.role, content: x.content, createdAt: x.createdAt.toISOString() })) })); crossActivity = msgs.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 15) }
      let tasks: Array<{ id: string; title: string; status: string; priority: string }> = []
      if (ws.projectId) tasks = await db.task.findMany({ where: { projectId: ws.projectId }, orderBy: [{ status: 'asc' }, { priority: 'desc' }], take: 20, select: { id: true, title: true, status: true, priority: true } })
      const workspaceInfo: WorkspaceInfo = { id: ws.id, name: ws.name, type: ws.type as WorkspaceInfo['type'], description: ws.description, color: ws.color, status: ws.status, projectId: ws.projectId, customerId: ws.customerId, subcontractorId: ws.subcontractorId, supplierId: ws.supplierId, chats: [], chatCount: 0, project: ws.project ? { id: ws.project.id, title: ws.project.title, status: ws.project.status, priority: ws.project.priority, address: ws.project.address, value: ws.project.value, customer: ws.project.customer } : null, customer: ws.customer, subcontractor: ws.subcontractor }
      systemPrompt = buildChannelPrompt({ channelType: chat.chatType as ChannelType, workspace: workspaceInfo, contractorName: contractor.company ?? contractor.name, recentMemory: recentMemory.map(m => ({ category: m.category, content: m.content, createdAt: m.createdAt.toISOString() })), crossChannelActivity: crossActivity, tasks })
    } else {
      const workspaces = await db.workspace.findMany({ where: { contractorId: contractor.id, status: 'active' }, include: { chats: { select: { id: true, chatType: true }, orderBy: { chatType: 'asc' } } } })
      systemPrompt = buildCommandCenterPrompt({ contractorName: contractor.company ?? contractor.name, workspaceMap: workspaces.map(w => ({ id: w.id, name: w.name, type: w.type, chats: w.chats.map(c => ({ chatType: c.chatType, id: c.id })) })) })
    }

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }]
    if (businessContext && !workspaceId) messages.push({ role: 'system', content: `CURRENT BUSINESS CONTEXT:\n${businessContext}` })
    for (const h of history.slice(-20)) messages.push({ role: h.role, content: h.content })
    messages.push({ role: 'user', content: message })

    job.heartbeat = 'Thinking...'
    const loopResult = await runAgentLoop({ messages, contractorId: contractor.id, conversationId: conversation.id, workspaceId, chatId, documentIds, maxIterations: 4, onIteration: (iter) => { if (!iter.final) { const j = jobs.get(jobId); if (j) { const toolNames = iter.toolCalls.map(tc => tc.name); j.thinking.push({ text: safeThinkingText(iter.text, toolNames), toolCalls: iter.toolCalls.map(tc => ({ name: tc.name, args: tc.args })), toolResults: iter.toolResults?.map(r => ({ name: r.name, success: r.success, summary: r.success ? 'Done' : 'Needs attention' })) }); j.heartbeat = safeThinkingText(iter.text, toolNames) } } } })
    clearInterval(hb)

    const finalText = sanitizeGeneratedStorageUrls(loopResult.final.text || '(no response)')
    const toolCard = deriveCardFromToolResults(loopResult.iterations)
    const finalContextType = loopResult.final.contextType ?? toolCard?.contextType ?? null
    const finalContextData = loopResult.final.contextData ?? toolCard?.contextData ?? null
    const finalActions = (loopResult.final.actions ?? []) as AiAction[]
    let finalAttachments = loopResult.final.attachments ?? []
    finalAttachments = finalAttachments.map((a: any) => ({
      ...a,
      url: typeof a.url === 'string' ? sanitizeGeneratedStorageUrls(a.url) : a.url,
      thumbnailUrl: typeof a.thumbnailUrl === 'string' ? sanitizeGeneratedStorageUrls(a.thumbnailUrl) : a.thumbnailUrl,
    }))
    if (finalAttachments.length === 0) {
      finalAttachments = collectImageAttachmentsFromToolData(loopResult.iterations.flatMap(iter => iter.toolResults?.map(r => r.data) ?? []))
    }
    let actionResults: Array<{ action: string; status: string; detail: string; targetChatType?: string }> = []
    if (finalActions.length > 0 && workspaceId) {
      const ws = await db.workspace.findFirst({ where: { contractorId: contractor.id, status: 'active' }, include: { chats: { select: { id: true, chatType: true } } } })
      const mentionedWs = ws ? (message.toLowerCase().includes(ws.name.toLowerCase().split(' ')[0]) ? ws : null) : null
      if (mentionedWs) { const sc = mentionedWs.chats.find(c => c.chatType === 'main'); if (sc) actionResults = await executeActions(finalActions, { workspaceId: mentionedWs.id, sourceChatId: chatId ?? sc.id, sourceChatType: (chatId ? (mentionedWs.chats.find(c => c.id === chatId)?.chatType ?? 'main') : 'main') as ChannelType, contractorId: contractor.id }) }
    }

    if (workspaceId && chatId) {
      await db.workspaceMessage.create({ data: { chatId, role: 'assistant', content: finalText, contextType: finalContextType, contextData: finalContextData ? JSON.stringify(finalContextData) : null, actionResults: actionResults.length ? JSON.stringify(actionResults) : null, attachments: finalAttachments.length ? JSON.stringify(finalAttachments) : null } })
      await db.workspaceChat.update({ where: { id: chatId }, data: { lastActivity: new Date() } })
    } else {
      await db.message.create({ data: { conversationId: conversation.id, role: 'assistant', content: finalText, contextType: finalContextType, contextData: finalContextData ? JSON.stringify(finalContextData) : null, actionResults: actionResults.length ? JSON.stringify(actionResults) : null, attachments: finalAttachments.length ? JSON.stringify(finalAttachments) : null } })
      if ((!conversation.title || conversation.title === 'New Chat' || conversation.title === 'New private chat' || conversation.title === 'Welcome to Jobrolo') && message) await db.conversation.update({ where: { id: conversation.id }, data: { title: message.slice(0, 60), updatedAt: new Date() } })
      else await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
    }

    const j = jobs.get(jobId)
    if (j) { j.status = 'done'; j.result = { text: finalText, actionResults, attachments: finalAttachments, contextType: finalContextType, contextData: finalContextData, conversationId: conversation.id } }
  } catch (err) {
    console.error('[chat-job] failed:', err); clearInterval(hb)
    const j = jobs.get(jobId); if (j) { j.status = 'error'; j.error = err instanceof Error ? err.message : 'Unknown error' }
  }
}
