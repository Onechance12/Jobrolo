import { NextRequest, NextResponse } from 'next/server'
import { checkBodySize } from '@/lib/security/body-size'
import { requireDevBridge, safeText } from '@/lib/dev-bridge'
import { buildSkillRoutingContext } from '@/lib/skills/context'
import { selectSkills } from '@/lib/skills/select-skill'
import { orchestrateSkills } from '@/lib/skills/orchestrate-skills'
import { hasLocalTruthMutationIntent, resolveLocalTruthRoute } from '@/lib/truth/resolve-local-truth'

export const runtime = 'nodejs'

function stringValue(value: unknown, max = 2000) {
  return safeText(value, max) || undefined
}

function boolValue(value: unknown) {
  return value === true || value === 'true'
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
  const message = stringValue(record.message, 8000)
  if (!message) return NextResponse.json({ error: 'message is required.' }, { status: 400 })

  const activeProjectId = stringValue(record.activeProjectId, 200) ?? null
  const activeCustomerId = stringValue(record.activeCustomerId, 200) ?? null
  const activeWorkspaceId = stringValue(record.activeWorkspaceId, 200) ?? null
  const channelType = stringValue(record.channelType, 100)
  const role = stringValue(record.role, 100)
  const highComplexity = boolValue(record.highComplexity)

  const localTruthRoute = resolveLocalTruthRoute(message, { activeProjectId })
  const skillContext = buildSkillRoutingContext({
    latestText: message,
    channelType,
    role,
    activeCustomerId,
    activeProjectId,
    activeWorkspaceId,
  })
  const skillSelections = selectSkills(skillContext)
  const orchestration = orchestrateSkills(skillContext, { highComplexity })
  const mutationIntent = hasLocalTruthMutationIntent(message)

  return NextResponse.json({
    status: 'ok',
    dryRun: true,
    note: 'Synthetic chat route inspection only. This does not create messages, call OpenAI, execute tools, or mutate records.',
    input: {
      message,
      activeProjectId,
      activeCustomerId,
      activeWorkspaceId,
      channelType,
      role,
      highComplexity,
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
            ? 'Mutation-like request must go through the full trusted agent/tool/approval path.'
            : 'No deterministic local-truth read route matched this prompt.',
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
  })
}
