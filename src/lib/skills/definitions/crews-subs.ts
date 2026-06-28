import type { JobroloSkill } from '../types'

export const crewsSubsSkills: JobroloSkill[] = [
  {
    id: 'crew-subcontractor',
    name: 'Crew/Subcontractor',
    category: 'crews_subs',
    status: 'planned',
    risk: 'medium',
    priority: 60,
    purpose: 'Create and manage crew/subcontractor chats, instructions, invite links, and job-limited visibility.',
    whenToUse: ['Crew chat', 'Subcontractor invite', 'Work order', 'Roofing/gutter/window crew'],
    allowedRoles: ['owner', 'admin', 'production', 'office', 'crew', 'system'],
    approvalRequiredFor: ['external crew invites', 'share links'],
    decisionRules: [
      'Crew chats must be tied to a real project/job and specific crew type when possible.',
      'Subs/crews can only see their assigned chats/jobs and should not delete company/project chats.',
      'Invite links/codes must preserve company, chat, role, and permission scope.',
    ],
  },
]
