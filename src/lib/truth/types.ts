import type { ToolCall } from '@/lib/prompts'

export type LocalTruthContext = {
  activeProjectId?: string | null
}

export type LocalTruthRoute = {
  id: string
  reason: string
  toolCall: ToolCall
  confidence: number
}

export type ToolExecutionResultLike = {
  success: boolean
  data: unknown
  error?: string
}
