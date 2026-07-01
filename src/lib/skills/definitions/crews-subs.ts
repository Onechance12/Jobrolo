import type { JobroloSkill } from '../types'

export const crewsSubsSkills: JobroloSkill[] = [
  {
    id: 'crew-subcontractor',
    name: 'Crew/Subcontractor',
    category: 'crews_subs',
    status: 'active',
    risk: 'medium',
    priority: 76,
    purpose: 'Create and manage crew/subcontractor chats, instructions, invite links, and job-limited visibility.',
    whenToUse: ['Crew chat', 'Subcontractor invite', 'Work order', 'Roofing/gutter/window crew'],
    allowedRoles: ['owner', 'admin', 'production', 'office', 'crew', 'system'],
    allowedTools: ['get_customer_file', 'get_project_document_packet', 'create_project_chat', 'invite_user_to_chat'],
    approvalRequiredFor: ['external crew invites', 'share links'],
    decisionRules: [
      'Crew chats must be tied to a real project/job and specific crew type when possible.',
      'Subs/crews can only see their assigned chats/jobs and should not delete company/project chats.',
      'Invite links/codes must preserve company, chat, role, and permission scope.',
      'If the crew type is unclear, ask whether this is roofing, gutters, windows, interior, general labor, or another crew.',
      'When a crew chat is created, return the chat card with open, copy link, and invite actions immediately.',
    ],
    output: { cards: ['shared-chat', 'production-status'] },
    outputFormat: 'Crew chat card with project, crew type, visibility, invite/link actions, and one editable starter prompt.',
  },
]
