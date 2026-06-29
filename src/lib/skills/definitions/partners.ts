import type { JobroloSkill } from '../types'

export const partnerSkills: JobroloSkill[] = [
  {
    id: 'adjuster',
    name: 'Adjuster/Carrier',
    category: 'partners',
    status: 'planned',
    risk: 'medium',
    priority: 48,
    purpose: 'Support adjuster/carrier-facing communications and shared claim documents with strict external visibility.',
    whenToUse: ['Adjuster chat', 'Carrier documents', 'Claim communication'],
    allowedRoles: ['owner', 'admin', 'supplement', 'office', 'adjuster', 'system'],
    approvalRequiredFor: ['external claim sends', 'shared claim links'],
    decisionRules: ['Only share approved claim/project documents and never expose internal notes by default.'],
    output: { cards: ['external-share', 'insurance-claim', 'shared-chat'] },
  },
  {
    id: 'realtor',
    name: 'Realtor/Referral Partner',
    category: 'partners',
    status: 'planned',
    risk: 'medium',
    priority: 45,
    purpose: 'Support referral partners with limited shared chats, project updates, referral tracking, and safe visibility.',
    whenToUse: ['Referral partner', 'Realtor chat', 'Insurance agent partner'],
    allowedRoles: ['owner', 'admin', 'sales', 'office', 'realtor', 'system'],
    approvalRequiredFor: ['external partner invites', 'shared customer/project updates'],
    decisionRules: ['Partners see only explicitly shared chats/files/updates, not internal CRM data.'],
    output: { cards: ['external-share', 'shared-chat'] },
  },
]
