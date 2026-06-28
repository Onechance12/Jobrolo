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
    whenToUse: ['note to cody', 'note to codex', 'tester bug report', 'QA review'],
    allowedRoles: ['owner', 'admin', 'system'],
    allowedTools: ['record_tester_feedback'],
    decisionRules: [
      'Tester notes should be captured as product feedback, not customer/job notes.',
      'When a tester reports a workaround need, answer with a safe alternate path and capture the bug.',
    ],
  },
  {
    id: 'codex-packet',
    name: 'Codex Packet',
    category: 'meta',
    status: 'planned',
    risk: 'low',
    priority: 30,
    purpose: 'Package product findings, logs, tests, and implementation notes into actionable Codex tasks.',
    whenToUse: ['Create task for Codex', 'Summarize bugs for Cody', 'Implementation packet'],
    allowedRoles: ['owner', 'admin', 'system'],
    decisionRules: ['Keep implementation packets scoped, file-specific, and tied to observed failures.'],
  },
]
