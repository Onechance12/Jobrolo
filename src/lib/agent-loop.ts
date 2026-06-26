// =============================================================================
// Agent Loop v2 — Plan-then-Execute with tool validation, permissioning, retry
// =============================================================================

import { chatComplete, type ChatMessage } from '@/lib/ai'
import { executeTool, getToolDefinitions, isToolAllowedInChannel } from '@/lib/agent/tools-v2'
import { parseAIResponse, type ParsedAIResponse, type ToolCall } from '@/lib/prompts'
import type { ChannelType } from '@/lib/types'

export interface AgentIteration {
  iteration: number
  text: string
  toolCalls: ToolCall[]
  toolResults?: Array<{ name: string; success: boolean; data: unknown; error?: string }>
  final: boolean
}

export interface AgentLoopOptions {
  messages: ChatMessage[]
  contractorId: string
  userId?: string
  userRole?: string
  trustedDirectExecution?: boolean
  workspaceId?: string
  chatId?: string
  channelType?: ChannelType
  documentIds?: string[]  // IDs of documents uploaded with the current message
  maxIterations?: number
  onIteration?: (iter: AgentIteration) => void
}

export interface AgentLoopResult {
  final: ParsedAIResponse
  iterations: AgentIteration[]
  totalToolCalls: number
}

const MAX_RETRIES = 4
const TOOL_NAMES = new Set(getToolDefinitions().map(t => t.name))
const EXECUTABLE_ACTION_TYPES = new Set(['cross_post', 'memory', 'task', 'task_update', 'note'])

const OPERATIONAL_INTENT_PHRASES = [
  'let me search', 'let me check', 'let me look', 'let me find', 'let me retrieve', 'let me get',
  'let me review', 'let me pull', 'let me grab', 'let me fetch', 'let me show', 'let me list', 'let me see',
  'let me first', 'let me help', 'let me process', 'let me save', 'let me create', 'let me update',
  'let me add', 'let me attach', 'let me link', 'let me import', 'let me extract', 'let me upload',
  'let me clear', 'let me proceed',
  "i'll search", "i'll check", "i'll look", "i'll find", "i'll retrieve", "i'll get", "i'll review",
  "i'll pull", "i'll grab", "i'll fetch", "i'll show", "i'll list", "i'll see", "i'll process",
  "i'll help", "i'll first", "i'll save", "i'll create", "i'll update", "i'll add", "i'll attach",
  "i'll link", "i'll import", "i'll extract", "i'll upload", "i'll clear", "i'll proceed", "i'll now",
  'i will search', 'i will check', 'i will look', 'i will find', 'i will retrieve', 'i will get', 'i will review',
  'i will pull', 'i will grab', 'i will fetch', 'i will show', 'i will first', 'i will help',
  'i will process', 'i will save', 'i will create', 'i will update', 'i will add', 'i will attach',
  'i will link', 'i will import', 'i will extract', 'i will upload', 'i will clear', 'i will proceed',
  'i will now', 'please hold on', 'one moment', 'checking now', 'searching now', 'looking now',
  'first, let me', 'first let me',
  'requires approval before', 'requires approval to', 'review and approve', 'approval request',
  'please approve', 'please confirm the deletion request', 'approve the deletion request',
]

const COMPLETION_CLAIM_PHRASES = [
  'i saved', "i've saved", 'saved it', 'has been saved',
  'i created', "i've created", 'has been created',
  'i added', "i've added", 'has been added',
  'i updated', "i've updated", 'has been updated',
  'i attached', "i've attached", 'has been attached',
  'i linked', "i've linked", 'has been linked',
  'i imported', "i've imported", 'has been imported',
  'done', 'completed',
]

function hasOperationalIntent(text: string) {
  const lower = text.toLowerCase()
  return OPERATIONAL_INTENT_PHRASES.some(phrase => lower.includes(phrase))
}

function hasCompletionClaim(text: string) {
  const lower = text.toLowerCase()
  return COMPLETION_CLAIM_PHRASES.some(phrase => lower.includes(phrase))
}

function findNullishIdArg(value: unknown, path = 'args'): string | null {
  if (!value || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    if (/(^id$|id$|Id$)/.test(key) && (child === null || child === undefined || child === '')) {
      return childPath
    }
    const nested = findNullishIdArg(child, childPath)
    if (nested) return nested
  }
  return null
}

function isIdLikeKey(key: string) {
  return /(^id$|id$|Id$)/.test(key)
}

function looksLikePlaceholder(value: string, key: string) {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (!trimmed) return false
  if (/^<[^>]+>$/.test(trimmed)) return true
  if (/\bplaceholder\b/.test(lower)) return true
  if (isIdLikeKey(key)) {
    return (
      lower === 'id' ||
      lower === 'project id' ||
      lower === 'customer id' ||
      lower === 'document id' ||
      lower === "timothy's id" ||
      lower.endsWith('_id') ||
      /\b(customer|project|document|scope|timothy)\b.*\bid\b/.test(lower)
    )
  }
  if (key === 'rawText') {
    return (
      lower === 'scope information' ||
      lower === 'provided scope information' ||
      lower === 'provided text' ||
      (lower.includes('scope information') && trimmed.length < 120)
    )
  }
  return false
}

function sanitizeToolArgs(value: unknown, path = 'args'): { value: unknown; removed: string[]; invalid?: string } {
  if (typeof value === 'string') {
    const key = path.split('.').pop() ?? ''
    if (looksLikePlaceholder(value, key)) {
      if (isIdLikeKey(key)) return { value: undefined, removed: [path] }
      return { value, removed: [], invalid: `${path} is a placeholder, not real saved data` }
    }
    return { value, removed: [] }
  }
  if (Array.isArray(value)) {
    const next: unknown[] = []
    const removed: string[] = []
    for (let i = 0; i < value.length; i++) {
      const result = sanitizeToolArgs(value[i], `${path}[${i}]`)
      if (result.invalid) return { value, removed, invalid: result.invalid }
      removed.push(...result.removed)
      if (result.value !== undefined) next.push(result.value)
    }
    return { value: next, removed }
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    const removed: string[] = []
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const result = sanitizeToolArgs(child, `${path}.${key}`)
      if (result.invalid) return { value, removed, invalid: result.invalid }
      removed.push(...result.removed)
      if (result.value !== undefined) next[key] = result.value
    }
    return { value: next, removed }
  }
  return { value, removed: [] }
}

function actionToToolCall(action: { type: string; [k: string]: unknown }): ToolCall | null {
  if (!TOOL_NAMES.has(action.type)) return null
  const { type, ...args } = action
  return { name: type, args }
}

function normalizeParsedWork(parsed: ParsedAIResponse) {
  const actions = parsed.actions ?? []
  const convertedToolCalls: ToolCall[] = []
  const executableActions: NonNullable<ParsedAIResponse['actions']> = []
  const blockedResults: NonNullable<AgentIteration['toolResults']> = []

  for (const action of actions) {
    const asTool = actionToToolCall(action)
    if (asTool) {
      console.warn(`[agent-loop] converted tool-like action '${action.type}' into tool_call`)
      convertedToolCalls.push(asTool)
      continue
    }
    if (EXECUTABLE_ACTION_TYPES.has(action.type)) {
      executableActions.push(action)
      continue
    }
    blockedResults.push({
      name: action.type || 'unknown_action',
      success: false,
      data: null,
      error: `Unknown action type '${action.type}'. Database/system operations must be sent as tool_calls, not actions.`,
    })
  }

  return { convertedToolCalls, executableActions, blockedResults }
}

function shouldForceToolRetry(parsed: ParsedAIResponse, toolCallCount: number, executableActionCount: number) {
  if (toolCallCount > 0 || executableActionCount > 0) return false
  return hasOperationalIntent(parsed.text) || hasCompletionClaim(parsed.text)
}

function buildMissingToolInstruction(text: string) {
  return `You said "${text.slice(0, 160)}" but did not include any tool_calls or actions.

If you are checking, saving, creating, updating, linking, attaching, importing, extracting, clearing, uploading, or retrieving system data, you MUST call the correct tool or include the correct action in strict JSON.

Common recovery examples:
- To list saved clients/customers, call list_customers.
- To attach an uploaded photo/file to a customer, call link_document_to_customer. A projectId is not required.
- If you previously asked whether to link/attach a document/photo and the user replied "yes" or "yea", call link_document_to_customer or the appropriate save/link tool using the prior document/customer context.
- To create a project/job for a customer, call create_project_for_customer.
- To delete a customer/client, call delete_customer, not delete_documents_by_name.
- To approve pending requests after the user says "yes approved", "yes delete", "yes", or "approved", call decide_pending_action_requests or decide_action_request. If the pending request is delete_customer, pass toolName="delete_customer" and do NOT create a new delete_customer approval.
- To create a crew/customer/project chat, call create_project_chat.
- To invite/add/share a chat with an employee, crew member, subcontractor, customer, homeowner, or sales rep, call invite_user_to_chat. If email is missing, ask for it.
- If the user says "yes create a project" after a customer was just discussed, use that customerName unless multiple customers are possible.

If no tool exists for the requested operation, do not claim it is done. Respond with final=true and clearly say the workflow cannot be saved/executed yet, naming the missing tool/workflow.

If a tool previously failed, say: "I tried, but it did not save. Here's the error: ..."

Respond as JSON only.`
}

async function chatWithRetry(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number; contractorId?: string; userId?: string }): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await chatComplete(messages, { ...opts, purpose: 'tool_reasoning', contractorId: opts.contractorId, userId: opts.userId })
    } catch (err) {
      lastErr = err
      const isRateLimit = err instanceof Error && /429|rate.?limit|too many requests/i.test(err.message)
      if (isRateLimit) {
        // Exponential backoff for rate limits: 3s, 6s, 12s, 24s
        const backoff = Math.min(30000, 3000 * Math.pow(2, attempt))
        console.warn(`[agent-loop] rate limited, attempt ${attempt + 1}/${MAX_RETRIES + 1}, backing off ${backoff}ms`)
        await new Promise(r => setTimeout(r, backoff))
      } else {
        // Non-rate-limit errors: short backoff, fewer retries
        if (attempt >= 1) throw err
        console.warn(`[agent-loop] error attempt ${attempt + 1}, backing off 500ms`)
        await new Promise(r => setTimeout(r, 500))
      }
    }
  }
  throw lastErr
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxIterations = opts.maxIterations ?? 4
  const messages = [...opts.messages]
  const iterations: AgentIteration[] = []
  let totalToolCalls = 0
  let lastBlockedReason: string | null = null

  for (let i = 0; i < maxIterations; i++) {
    const raw = await chatWithRetry(messages, { temperature: 0.3, maxTokens: 1500, contractorId: opts.contractorId, userId: opts.userId })
    const parsed = parseAIResponse(raw)
    const normalizedWork = normalizeParsedWork(parsed)
    const parsedToolCallCount = (parsed.tool_calls?.length ?? 0) + normalizedWork.convertedToolCalls.length
    const parsedActionCount = normalizedWork.executableActions.length

    if (!opts.workspaceId && parsedActionCount > 0 && parsedToolCallCount === 0) {
      lastBlockedReason = 'The assistant produced chat actions, but this main chat has no workspace context to execute them.'
      console.warn(`[agent-loop] blocked executable actions without workspace context iteration=${i} contractorId=${opts.contractorId}`)
      messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content: `You returned actions, but this is the main command center and there is no workspaceId to execute workspace actions.

If the user requested a database/system operation, use tool_calls.
If it can only be done inside a workspace/project chat, say that clearly and do not claim it was saved or completed.

Respond as JSON only.`,
      })
      continue
    }

    // Detect when the AI narrates operational work without actually calling a tool/action.
    // This is the trust boundary between "chat demo" and "operating system".
    if (shouldForceToolRetry(parsed, parsedToolCallCount, parsedActionCount)) {
      lastBlockedReason = 'The assistant narrated operational work without a valid executable tool call.'
      console.warn(`[agent-loop] blocked narrated action without tool iteration=${i} contractorId=${opts.contractorId}`)
      console.warn(`[agent-loop] forced retry for missing tool call iteration=${i} contractorId=${opts.contractorId}`)
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: buildMissingToolInstruction(parsed.text) })
      continue
    }

    let toolCalls = [...(parsed.tool_calls ?? []), ...normalizedWork.convertedToolCalls]
    const blockedToolResults: NonNullable<AgentIteration['toolResults']> = [...normalizedWork.blockedResults]
    if (normalizedWork.blockedResults.length > 0) {
      lastBlockedReason = normalizedWork.blockedResults.map(r => r.error).filter(Boolean).join('; ')
    }

    // Filter out tools not allowed in this channel (security: per-channel permissioning)
    if (opts.channelType) {
      toolCalls = toolCalls.filter(tc => {
        const allowed = isToolAllowedInChannel(tc.name, opts.channelType!)
        if (!allowed) console.warn(`[agent-loop] blocked tool '${tc.name}' in channel '${opts.channelType}'`)
        return allowed
      })
    }

    toolCalls = toolCalls.filter(tc => {
      const sanitized = sanitizeToolArgs(tc.args)
      if (sanitized.invalid) {
        const error = `Invalid tool args: ${sanitized.invalid}`
        console.warn(`[agent-loop] blocked placeholder tool call '${tc.name}' ${sanitized.invalid} contractorId=${opts.contractorId}`)
        blockedToolResults.push({ name: tc.name, success: false, data: null, error })
        lastBlockedReason = error
        return false
      }
      if (sanitized.removed.length > 0) {
        console.warn(`[agent-loop] removed placeholder id args for '${tc.name}': ${sanitized.removed.join(', ')} contractorId=${opts.contractorId}`)
        tc.args = sanitized.value as Record<string, unknown>
      }
      const badArgPath = findNullishIdArg(tc.args)
      if (!badArgPath) return true
      const error = `Invalid tool args: ${badArgPath} is required`
      console.warn(`[agent-loop] blocked invalid tool call '${tc.name}' ${badArgPath} contractorId=${opts.contractorId}`)
      blockedToolResults.push({ name: tc.name, success: false, data: null, error })
      lastBlockedReason = error
      return false
    })

    const isFinal = toolCalls.length > 0 ? false : parsed.final !== false
    const iteration: AgentIteration = { iteration: i, text: parsed.text, toolCalls, final: isFinal }

    if (toolCalls.length > 0) {
      console.log(`[agent-loop] tool calls detected; forcing post-tool final response contractorId=${opts.contractorId} count=${toolCalls.length}`)
      const results: AgentIteration['toolResults'] = [...blockedToolResults]
      for (const tc of toolCalls) {
        console.log(`[agent-loop] executing tool '${tc.name}' contractorId=${opts.contractorId}`)
        const result = await executeTool(tc.name, tc.args, opts.contractorId, {
          userId: opts.userId,
          userRole: opts.userRole,
          trustedDirectExecution: opts.trustedDirectExecution,
          workspaceId: opts.workspaceId,
          chatId: opts.chatId,
          channelType: opts.channelType,
          documentIds: opts.documentIds,
        })
        results.push({
          name: tc.name,
          success: result.success,
          data: result.data,
          error: result.error,
        })
        totalToolCalls++
      }
      iteration.toolResults = results
      opts.onIteration?.(iteration)
      messages.push({ role: 'assistant', content: JSON.stringify({ text: parsed.text, tool_calls: toolCalls, final: false }) })
      const toolResultsFormatted = results.map(r =>
        `TOOL RESULT: ${r.name}\n${r.success ? JSON.stringify(r.data, null, 2).slice(0, 3000) : `ERROR: ${r.error}`}`
      ).join('\n\n')
      const hasNonSavedResult = results.some(r => {
        const data = r.data as Record<string, unknown> | null
        return !r.success || Boolean(data?.needsProject || data?.needsCustomer || data?.needsClarification || data?.approvalRequired)
      })
      messages.push({
        role: 'user',
        content: `Tool results:\n\n${toolResultsFormatted}\n\nNow answer the user's original question using these real tool results. This must be the final user-facing answer based on tool results. Do not make up information. Only say saved/created/updated/linked/imported if a tool result confirms success with saved=true, created record ids, linked ids, or an executed mutation result.${hasNonSavedResult ? '\n\nIMPORTANT: At least one tool result did not complete the requested save/mutation or requires clarification/approval. Say exactly what is missing or what failed. Do not say the action is done.' : ''} If tools returned errors or approvalRequired, acknowledge that clearly.\n\nIf tool results include photos/images, include structured attachments using the exact relative url/thumbnailUrl returned by the tool. Do not write markdown image URLs. Never invent or use https://yourdomain.com.`,
      })
      iterations.push(iteration)
      continue
    } else {
      if (blockedToolResults.length > 0) {
        iteration.toolResults = blockedToolResults
        opts.onIteration?.(iteration)
        messages.push({ role: 'assistant', content: JSON.stringify({ text: parsed.text, tool_calls: parsed.tool_calls ?? [], final: false }) })
        const blockedFormatted = blockedToolResults.map(r => `TOOL RESULT: ${r.name}\nERROR: ${r.error}`).join('\n\n')
        messages.push({
          role: 'user',
          content: `Tool results:\n\n${blockedFormatted}\n\nAt least one tool call was blocked before execution because its required ID argument was missing/null. Do not claim the action succeeded. Either retry with valid arguments from saved records or tell the user what is missing.`,
        })
        iterations.push(iteration)
        continue
      }
      if (parsed.final !== false) {
        console.log(`[agent-loop] final answer without mutation contractorId=${opts.contractorId} toolCalls=0 actions=${parsedActionCount}`)
        if (totalToolCalls > 0) console.log(`[agent-loop] final answer based on tool results contractorId=${opts.contractorId}`)
      }
      opts.onIteration?.(iteration)
      iterations.push(iteration)
      return { final: parsed, iterations, totalToolCalls }
    }
  }
  const fallback: ParsedAIResponse = {
    text: lastBlockedReason
      ? `I tried, but it did not save or complete. ${lastBlockedReason}`
      : iterations[iterations.length - 1]?.text ?? 'I got stuck. Could you rephrase?',
    actions: [], tool_calls: [], final: true,
  }
  return { final: fallback, iterations, totalToolCalls }
}
