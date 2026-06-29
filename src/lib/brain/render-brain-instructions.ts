import type { JobroloBrainContext } from './types'

export function renderBrainInstructions(brain: JobroloBrainContext | undefined) {
  if (!brain) return ''
  const lines = [
    `BRAINSTEM CONTEXT: ${brain.summary}`,
    `Brain mode=${brain.mode}; sentiment=${brain.sentiment}; urgency=${brain.urgency}.`,
  ]
  for (const signal of brain.signals.slice(0, 4)) {
    lines.push(`Brain signal: ${signal.label} (${signal.confidence.toFixed(2)}) — ${signal.instruction}`)
  }
  for (const path of brain.suggestedPaths.slice(0, 3)) lines.push(`Suggested path: ${path}`)
  for (const guardrail of brain.guardrails.slice(0, 4)) lines.push(`Brain guardrail: ${guardrail}`)
  return lines.join('\n')
}
