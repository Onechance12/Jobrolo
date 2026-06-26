// =============================================================================
// Agent Loop v2 — Plan-then-Execute with tool validation, permissioning, retry
// =============================================================================

import { chatComplete, type ChatMessage } from '@/lib/ai'
import { executeTool, isToolAllowedInChannel } from '@/lib/agent/tools-v2'
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

function shouldForceToolRetry(parsed: ParsedAIResponse, toolCallCount: number, actionCount: number) {
  if (toolCallCount > 0 || actionCount > 0) return false
  return hasOperationalIntent(parsed.text) || hasCompletionClaim(parsed.text)
}

function buildMissingToolInstruction(text: string) {
  return `You said "${text.slice(0, 160)}" but did not include any tool_calls or actions.

If you are checking, saving, creating, updating, linking, attaching, importing, extracting, clearing, uploading, or retrieving system data, you MUST call the correct tool or include the correct action in strict JSON.

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

  for (let i = 0; i < maxIterations; i++) {
    const raw = await chatWithRetry(messages, { temperature: 0.3, maxTokens: 1500, contractorId: opts.contractorId, userId: opts.userId })
    const parsed = parseAIResponse(raw)
    const parsedToolCallCount = parsed.tool_calls?.length ?? 0
    const parsedActionCount = parsed.actions?.length ?? 0

    // Detect when the AI narrates operational work without actually calling a tool/action.
    // This is the trust boundary between "chat demo" and "operating system".
    if (shouldForceToolRetry(parsed, parsedToolCallCount, parsedActionCount)) {
      console.warn(`[agent-loop] blocked narrated action without tool iteration=${i} contractorId=${opts.contractorId}`)
      console.warn(`[agent-loop] forced retry for missing tool call iteration=${i} contractorId=${opts.contractorId}`)
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: buildMissingToolInstruction(parsed.text) })
      continue
    }

    let toolCalls = parsed.tool_calls ?? []
    const blockedToolResults: NonNullable<AgentIteration['toolResults']> = []

    // Filter out tools not allowed in this channel (security: per-channel permissioning)
    if (opts.channelType) {
      toolCalls = toolCalls.filter(tc => {
        const allowed = isToolAllowedInChannel(tc.name, opts.channelType!)
        if (!allowed) console.warn(`[agent-loop] blocked tool '${tc.name}' in channel '${opts.channelType}'`)
        return allowed
      })
    }

    toolCalls = toolCalls.filter(tc => {
      const badArgPath = findNullishIdArg(tc.args)
      if (!badArgPath) return true
      const error = `Invalid tool args: ${badArgPath} is required`
      console.warn(`[agent-loop] blocked invalid tool call '${tc.name}' ${badArgPath} contractorId=${opts.contractorId}`)
      blockedToolResults.push({ name: tc.name, success: false, data: null, error })
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
          approved: tc.name === 'create_customer' ? true : undefined,
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
      messages.push({
        role: 'user',
        content: `Tool results:\n\n${toolResultsFormatted}\n\nNow answer the user's original question using these real tool results. This must be the final user-facing answer based on tool results. Do not make up information. Only say saved/created/updated/linked/imported if a tool result confirms success. If tools returned errors or approvalRequired, acknowledge that clearly.`,
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
    text: iterations[iterations.length - 1]?.text ?? 'I got stuck. Could you rephrase?',
    actions: [], tool_calls: [], final: true,
  }
  return { final: fallback, iterations, totalToolCalls }
}
