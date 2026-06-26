import { db } from '@/lib/db'

export type AIUsagePurpose =
  | 'chat'
  | 'tool_reasoning'
  | 'document_extraction'
  | 'image_analysis'
  | 'scope_parsing'
  | 'price_sheet_extraction'
  | 'web_search'
  | 'tts'

const COST_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
}

function estimateCost(model: string, inputTokens?: number | null, outputTokens?: number | null, imageCount?: number | null) {
  const pricing = COST_PER_1M_TOKENS[model]
  if (!pricing && !imageCount) return null
  const tokenCost = pricing
    ? (((inputTokens ?? 0) / 1_000_000) * pricing.input) + (((outputTokens ?? 0) / 1_000_000) * pricing.output)
    : 0
  // Rough placeholder: OpenAI image/token billing varies by detail and image size.
  // Keep it conservative and explicitly estimated.
  const imageCost = imageCount ? imageCount * 0.001 : 0
  return tokenCost + imageCost
}

export async function logAIUsage(input: {
  contractorId?: string | null
  userId?: string | null
  customerId?: string | null
  projectId?: string | null
  documentId?: string | null
  purpose: AIUsagePurpose
  provider: string
  model: string
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  imageCount?: number | null
  webSearchCalls?: number | null
  success: boolean
  error?: string | null
}) {
  if (!input.contractorId) return
  try {
    const estimatedCost = estimateCost(input.model, input.inputTokens, input.outputTokens, input.imageCount)
    await db.aIUsageLog.create({
      data: {
        contractorId: input.contractorId,
        userId: input.userId ?? null,
        customerId: input.customerId ?? null,
        projectId: input.projectId ?? null,
        documentId: input.documentId ?? null,
        purpose: input.purpose,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        imageCount: input.imageCount ?? 0,
        webSearchCalls: input.webSearchCalls ?? 0,
        estimatedCost,
        success: input.success,
        error: input.error ? input.error.slice(0, 1000) : null,
      },
    })
    console.log('[ai-usage] logged', { purpose: input.purpose, provider: input.provider, model: input.model, success: input.success })
  } catch (err) {
    console.error('[ai-usage] failed to log:', err)
  }
}
