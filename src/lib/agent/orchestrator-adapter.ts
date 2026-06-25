// =============================================================================
// Orchestrator Adapter — read-only planning consultant
// =============================================================================
// This adapter provides a safe, read-only interface to the orchestrator's
// planning/decomposition logic WITHOUT executing any tools or mutating state.
//
// It reuses the core idea from src/lib/orchestrator.ts (ask the LLM to
// decompose a complex request into a structured plan) but:
//   - Uses the ACTIVE tools-v2 registry for tool names/descriptions
//   - Never calls executeTool or any legacy tools
//   - Never writes to the database
//   - Never sends messages or creates records
//   - Returns a plan that the main agent loop executes using tools-v2
// =============================================================================

import { chatComplete, type ChatMessage } from '@/lib/ai'
import { getToolDefinitions } from '@/lib/agent/tools-v2'
import type { ChannelType } from '@/lib/types'

// ─── Return types ────────────────────────────────────────────────────────────

export interface PlannedStep {
  step: string
  suggestedTool: string | null
  requiresApproval: boolean
  reason: string
}

export type OperatorMode = 'owner' | 'sales' | 'field' | 'supplementer' | 'public_adjuster' | 'appraisal' | 'production' | 'admin' | 'canvassing' | 'general'

export interface OrchestratorPlan {
  operatorMode: OperatorMode
  summary: string
  complexity: 'simple' | 'moderate' | 'complex'
  recommendedSteps: PlannedStep[]
  missingContext: string[]
  risks: string[]
  finalRecommendation: string
}

// ─── Active tool list for the planner prompt ─────────────────────────────────

function formatActiveToolsForPlanner(): string {
  const tools = getToolDefinitions()
  return tools.map(t => `- ${t.name}: ${t.description}`).join('\n')
}

const ACTIVE_TOOLS_BLOCK = formatActiveToolsForPlanner()

// ─── Planner prompt ──────────────────────────────────────────────────────────

function buildPlannerPrompt(channelContext?: string, entityContext?: string): string {
  return `You are Jobrolo's planning consultant. Your job is to analyze complex user requests and produce a structured execution plan. You do NOT execute anything — you only plan.

AVAILABLE TOOLS (these are the ONLY tools that can be used):
${ACTIVE_TOOLS_BLOCK}

OPERATOR MODES — detect from context which operator posture fits:
- owner: business owner, executive, money/bottleneck/risk/stalled jobs focus
- sales: homeowner conversation, inspection, follow-up, closing
- field: on-site, photos, roof conditions, damage evidence, job-site steps
- supplementer: carrier estimate gaps, missing line items, RCV/ACV, supplement opportunity
- public_adjuster: PA, claim file, policy/declarations, denial, underpayment, appraisal, carrier dispute. Use cautious language. NEVER provide legal advice. Recommend licensed PA/attorney review for coverage disputes, denials, bad faith, or policy interpretation.
- appraisal: appraisal readiness, dispute amount, umpire, packet preparation
- production: schedule, crew, materials, permits, job readiness
- admin: tasks, documents, signatures, reminders, cleanup
- canvassing: street/property intelligence, door attempts, follow-ups, scripts
- general: default contractor operations

RULES:
1. Set operatorMode based on the request context and signals above.
2. If the request is simple (single lookup, greeting, one obvious action), set complexity to "simple" with at most 1 step.
3. If the request involves 2-3 related actions, set complexity to "moderate".
4. If the request requires coordinating across customers, projects, documents, signatures, property memory, canvassing, or roof reports, set complexity to "complex".
5. Each recommended step should map to at most ONE tool from the available tools list. If no tool matches, set suggestedTool to null.
6. Mark requiresApproval as true if the suggested tool would modify data, create records, send messages, or require human sign-off.
7. List any missing context the agent needs before it can act (e.g., "which project?", "customer name?").
8. List risks: data safety, approval requirements, incomplete info, cross-channel side effects, legal/license risks for PA/appraisal contexts.
9. The finalRecommendation should tell the main agent what to do first.
${channelContext ? `\nCURRENT CHANNEL: ${channelContext}` : ''}
${entityContext ? `\nCURRENT ENTITY: ${entityContext}` : ''}

RESPOND AS JSON:
{
  "operatorMode": "owner | sales | field | supplementer | public_adjuster | appraisal | production | admin | canvassing | general",
  "summary": "short explanation of the request",
  "complexity": "simple | moderate | complex",
  "recommendedSteps": [
    {
      "step": "what should happen",
      "suggestedTool": "tool name from available tools, or null",
      "requiresApproval": true/false,
      "reason": "why this step is needed"
    }
  ],
  "missingContext": ["items the agent needs before acting"],
  "risks": ["safety/security/data/approval/legal risks"],
  "finalRecommendation": "what the main agent should do next"
}

Return JSON only. No markdown. No code fences.`
}

// ─── Plan parser ─────────────────────────────────────────────────────────────

function parsePlan(raw: string): OrchestratorPlan {
  let cleaned = raw.trim()
  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
  }

  try {
    const parsed = JSON.parse(cleaned)

    const steps: PlannedStep[] = Array.isArray(parsed.recommendedSteps)
      ? parsed.recommendedSteps.map((s: any) => ({
          step: String(s.step ?? ''),
          suggestedTool: s.suggestedTool ? String(s.suggestedTool) : null,
          requiresApproval: Boolean(s.requiresApproval),
          reason: String(s.reason ?? ''),
        }))
      : []

    const validModes: OperatorMode[] = ['owner', 'sales', 'field', 'supplementer', 'public_adjuster', 'appraisal', 'production', 'admin', 'canvassing', 'general']
    const operatorMode: OperatorMode = validModes.includes(parsed.operatorMode) ? parsed.operatorMode : 'general'

    return {
      operatorMode,
      summary: String(parsed.summary ?? ''),
      complexity: ['simple', 'moderate', 'complex'].includes(parsed.complexity) ? parsed.complexity : 'moderate',
      recommendedSteps: steps,
      missingContext: Array.isArray(parsed.missingContext) ? parsed.missingContext.map(String) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      finalRecommendation: String(parsed.finalRecommendation ?? ''),
    }
  } catch {
    // If parsing fails, return a minimal plan that tells the agent to proceed normally
    return {
      operatorMode: 'general',
      summary: 'Could not parse orchestrator plan',
      complexity: 'moderate',
      recommendedSteps: [],
      missingContext: [],
      risks: ['Orchestrator plan parsing failed — agent should proceed with normal tool use'],
      finalRecommendation: 'Proceed with normal tool-based execution. The orchestrator could not produce a structured plan.',
    }
  }
}

// ─── Main entry: consultOrchestrator ─────────────────────────────────────────

export async function consultOrchestrator(input: {
  userRequest: string
  channelType?: ChannelType
  entityContext?: string
}): Promise<OrchestratorPlan> {
  const channelContext = input.channelType ?? undefined
  const systemPrompt = buildPlannerPrompt(channelContext, input.entityContext)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input.userRequest },
  ]

  const raw = await chatComplete(messages, {
    temperature: 0.2,
    maxTokens: 2000,
  })

  return parsePlan(raw)
}
