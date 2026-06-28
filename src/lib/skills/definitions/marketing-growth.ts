import type { JobroloSkill } from '../types'

export const marketingGrowthSkills: JobroloSkill[] = [
  {
    id: 'company-intelligence',
    name: 'Company Intelligence',
    category: 'marketing_growth',
    status: 'planned',
    risk: 'external',
    priority: 42,
    purpose: 'Combine public web/social research with internal Jobrolo KPIs to suggest practical growth actions.',
    whenToUse: ['Research company online', 'Show company health', 'What should we do to grow?', 'Social/review presence'],
    allowedRoles: ['owner', 'admin', 'system'],
    approvalRequiredFor: ['saving public research into company profile', 'external outreach'],
    decisionRules: [
      'Label public-search evidence separately from connected private analytics.',
      'Do not claim private traffic attribution without connected analytics integrations.',
      'De-duplicate sources before showing previews.',
    ],
  },
]
