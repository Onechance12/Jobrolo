import type { JobroloSkill } from '../types'

export const metaJobroloSkills: JobroloSkill[] = [
  {
    id: 'qa',
    name: 'QA',
    category: 'meta',
    status: 'active',
    risk: 'low',
    priority: 40,
    purpose: 'Capture tester feedback, reproduce bugs, and verify skill/tool behavior without polluting customer/job data.',
    whenToUse: ['Cody Cody Cody', 'End Cody', 'note to cody', 'note to codex', 'tester bug report', 'QA review'],
    allowedRoles: ['owner', 'admin', 'system'],
    allowedTools: ['record_tester_feedback'],
    decisionRules: [
      'Tester notes should be captured as product feedback, not customer/job notes.',
      'When a tester reports a workaround need, answer with a safe alternate path and capture the bug.',
      'Cody mode is read-only analysis. It can collect context, summarize evidence, and prepare a Codex packet, but it cannot mutate customer, project, file, or company records.',
      'When a Cody block is active, keep summaries concise and focus on observed route, recent chat context, likely area, severity, and exact reproduction clues.',
    ],
    outputFormat: 'Cody review packet with observed issue, severity, evidence, likely route/tool area, and Codex-ready next step.',
  },
  {
    id: 'codex-packet',
    name: 'Codex Packet',
    category: 'meta',
    status: 'active',
    risk: 'low',
    priority: 62,
    purpose: 'Package product findings, logs, tests, and implementation notes into actionable Codex tasks.',
    whenToUse: ['Create task for Codex', 'Summarize bugs for Cody', 'Implementation packet'],
    allowedRoles: ['owner', 'admin', 'system'],
    decisionRules: [
      'Keep implementation packets scoped, file-specific, and tied to observed failures.',
      'Do not claim a root cause without logs, route, tool, screenshot, or reproduction evidence.',
      'Include safety notes when the issue touches auth, storage, private files, approvals, external messages, or tenant boundaries.',
    ],
    outputFormat: 'Codex packet with title, priority, area, evidence, expected/actual behavior, likely files, safety notes, and test checklist.',
  },
]
