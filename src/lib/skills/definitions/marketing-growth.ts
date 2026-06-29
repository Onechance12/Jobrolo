import type { JobroloSkill } from '../types'

export const marketingGrowthSkills: JobroloSkill[] = [
  {
    id: 'company-intelligence',
    name: 'Company Intelligence',
    category: 'marketing_growth',
    status: 'active',
    risk: 'external',
    priority: 78,
    purpose: 'Combine public web/social research with internal Jobrolo KPIs to suggest practical growth actions.',
    whenToUse: ['Research company online', 'Show company health', 'What should we do to grow?', 'Social/review presence'],
    allowedRoles: ['owner', 'admin', 'system'],
    approvalRequiredFor: ['saving public research into company profile', 'external outreach'],
    decisionRules: [
      'Label public-search evidence separately from connected private analytics.',
      'Do not claim private traffic attribution without connected analytics integrations.',
      'De-duplicate sources before showing previews.',
      'Use saved Jobrolo records for lead/project counts; use public search only for public web/social evidence.',
      'Do not overwrite company profile data from public research without explicit user approval.',
    ],
    output: { cards: ['company-intelligence'] },
    outputFormat: 'Company intelligence card with saved KPIs, public source previews, setup gaps, practical next moves, and clear confidence labels.',
  },
]
