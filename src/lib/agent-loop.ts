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

async function chatWithRetry(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number }): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await chatComplete(messages, opts)
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
    const raw = await chatWithRetry(messages, { temperature: 0.3, maxTokens: 1500 })
    const parsed = parseAIResponse(raw)

    // Detect when the AI says "let me search/check/look up" but didn't actually call a tool.
    // This is a common failure mode — the AI narrates intent without acting. Force it to retry.
    if ((parsed.tool_calls?.length ?? 0) === 0 && parsed.final !== false) {
      const intentPhrases = [
        "let me search", "let me check", "let me look", "let me find", "let me retrieve", "let me get",
        "let me review", "let me pull", "let me grab", "let me fetch", "let me show", "let me list", "let me see",
        "let me first", "let me help", "let me process",
        "i'll search", "i'll check", "i'll look", "i'll find", "i'll retrieve", "i'll get", "i'll review",
        "i'll pull", "i'll grab", "i'll fetch", "i'll show", "i'll list", "i'll see", "i'll process",
        "i'll help", "i'll first",
        "i will search", "i will check", "i will look", "i will find", "i will retrieve", "i will get", "i will review",
        "i will pull", "i will grab", "i will fetch", "i will show", "i will first", "i will help",
        "checking now", "searching now", "looking now",
        "first, let me", "first let me",
      ]
      const lowerText = parsed.text.toLowerCase()
      if (intentPhrases.some(phrase => lowerText.includes(phrase))) {
        console.warn(`[agent-loop] iteration ${i}: AI narrated intent without calling a tool — forcing retry`)
        messages.push({ role: 'assistant', content: raw })
        messages.push({
          role: 'user',
          content: `You said "${parsed.text.slice(0, 100)}" but you didn't actually call any tool. You MUST respond as JSON with tool_calls if you want to search for data. Do NOT narrate — ACT. Respond as JSON now: {"text": "what you're doing", "tool_calls": [{"name": "search_customers", "args": {"query": "..."}}, {"name": "list_documents", "args": {}}], "final": false}`
        })
        continue
      }
    }

    let toolCalls = parsed.tool_calls ?? []

    // Filter out tools not allowed in this channel (security: per-channel permissioning)
    if (opts.channelType) {
      toolCalls = toolCalls.filter(tc => {
        const allowed = isToolAllowedInChannel(tc.name, opts.channelType!)
        if (!allowed) console.warn(`[agent-loop] blocked tool '${tc.name}' in channel '${opts.channelType}'`)
        return allowed
      })
    }

    const isFinal = parsed.final !== false || toolCalls.length === 0
    const iteration: AgentIteration = { iteration: i, text: parsed.text, toolCalls, final: isFinal }

    if (toolCalls.length > 0) {
      const results: AgentIteration['toolResults'] = []
      for (const tc of toolCalls) {
        const result = await executeTool(tc.name, tc.args, opts.contractorId, {
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
        content: `Tool results:\n\n${toolResultsFormatted}\n\nNow answer the user's original question using this real data. Do not make up information. If tools returned errors, acknowledge them.`,
      })
      iterations.push(iteration)
      if (isFinal) return { final: parsed, iterations, totalToolCalls }
    } else {
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
