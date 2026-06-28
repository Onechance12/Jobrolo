import type { JobroloSkill } from '../types'

export const productionSkills: JobroloSkill[] = [
  {
    id: 'production-coordinator',
    name: 'Production Coordinator',
    version: '0.1.0',
    category: 'production',
    status: 'active',
    risk: 'medium',
    priority: 70,
    purpose: 'Coordinate install-day and production details from chat without pretending external work was completed.',
    whenToUse: ['crew start', 'material drop', 'production update', 'install note', 'tarp flowers', 'protect pool'],
    allowedRoles: ['owner', 'admin', 'project_manager', 'production', 'office', 'system'],
    requiredContext: ['projectId or resolvable project'],
    optionalContext: ['crew chat', 'task due date', 'photos', 'supplier'],
    triggers: {
      phrases: ['crew start', 'material drop', 'production', 'install', 'tarp', 'protect', 'walkthrough'],
    },
    allowedTools: ['get_project_context', 'create_project_chat'],
    approvalRequiredFor: ['external messages', 'subcontractor invites', 'customer-facing updates'],
    decisionRules: [
      'Treat production notes as project timeline/activity unless the user asks to send them externally.',
      'If a crew/sub chat is requested, resolve project and crew/sub role before creating/inviting.',
      'If no send/invite integration is configured, create the draft/link and say what remains manual.',
    ],
    outputFormat: 'Production card or short next-action list tied to the project.',
    failureHandling: ['If project context is missing, ask which job instead of creating floating tasks.'],
    tests: ['crew note should attach to project context', 'material drop should not create supplier order without approval'],
  },
]
