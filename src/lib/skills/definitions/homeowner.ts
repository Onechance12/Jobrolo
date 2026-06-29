import type { JobroloSkill } from '../types'

export const homeownerSkills: JobroloSkill[] = [
  {
    id: 'homeowner',
    name: 'Homeowner',
    category: 'homeowner',
    status: 'planned',
    risk: 'medium',
    priority: 54,
    purpose: 'Limit homeowner-facing chat, reports, approvals, and documents to safe external visibility.',
    whenToUse: ['Customer-facing chat', 'Homeowner portal', 'Share report', 'Customer update'],
    allowedRoles: ['owner', 'admin', 'sales', 'office', 'homeowner', 'system'],
    approvalRequiredFor: ['external sends', 'share links', 'customer-facing reports'],
    decisionRules: [
      'Homeowners only see their own shared customer/project data.',
      'Never expose internal margin, private notes, supplier pricing strategy, or unrelated customers/jobs.',
    ],
    output: { cards: ['external-share', 'shared-chat', 'roof-report'] },
  },
]
