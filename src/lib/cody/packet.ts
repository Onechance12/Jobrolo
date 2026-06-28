export type CodyArea =
  | 'uploads/files'
  | 'onboarding/auth'
  | 'shortcuts'
  | 'field'
  | 'company profile'
  | 'documents/ocr'
  | 'roof reports'
  | 'signatures'
  | 'notifications'
  | 'agent/tools'
  | 'security/permissions'
  | 'deployment'
  | 'database'
  | 'general'

export type CodySeverity = 'low' | 'normal' | 'high' | 'urgent'

export type CodyPacketInput = {
  content: string
  area?: string | null
  severity?: CodySeverity | string | null
  title?: string | null
  company?: string | null
  appUrl?: string | null
  currentUrl?: string | null
  debugContext?: Record<string, unknown> | null
  recentMessages?: Array<{ role?: string | null; text?: string | null; source?: string | null; createdAt?: unknown }> | null
  relevantIds?: Record<string, unknown> | null
}

export type CodyActivation = {
  audience: 'cody' | 'codex'
  content: string
}

export type CodyPacket = {
  title: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  severity: CodySeverity
  area: CodyArea
  role: 'read_only_developer_analyst'
  oneSentenceSummary: string
  whatICanSee: string[]
  likelyIssue: string
  expectedBehavior: string
  actualBehavior: string
  evidence: string[]
  reproductionSteps: string[]
  likelyFiles: string[]
  suggestedFixDirection: string
  safetyNotes: string[]
  doNotChange: string[]
  testChecklist: string[]
  codexTask: string
}

const AREA_PATTERNS: Array<[CodyArea, RegExp]> = [
  ['company profile', /\b(company|profile|logo|avatar|picture|brand|research website|company card|bbb|better business bureau|google review|setup gaps?|default terms|payment instructions|warranty|estimate disclaimer)\b/i],
  ['uploads/files', /\b(upload|file|photo|image|jpeg|jpg|png|pdf|document|attach|picker|thumbnail|storage)\b/i],
  ['documents/ocr', /\b(ocr|extract|analysis|analyzing|review docs?|scope|estimate|price sheet|template|classification)\b/i],
  ['onboarding/auth', /\b(onboard|signup|sign ?in|login|workspace|invite|join code|locked|stuck|setup mode|account)\b/i],
  ['notifications', /\b(notification|bell|action needed|approval|approve|inbox|twilio|sms|email)\b/i],
  ['shortcuts', /\b(shortcut|prompt|pill|button|quick command)\b/i],
  ['field', /\b(field|gps|map|inspection|canvass|location|lead|door knock|property research)\b/i],
  ['roof reports', /\b(roof report|report builder|pdf report|photo report|property report)\b/i],
  ['signatures', /\b(signature|signing|signed|contract final|signature request)\b/i],
  ['agent/tools', /\b(tool call|tool_call|narrated|no executable|agent|skill|loop|misfire|wrong workflow)\b/i],
  ['security/permissions', /\b(permission|role|tenant|public|private|leak|subcontractor|homeowner access|security)\b/i],
  ['deployment', /\b(render|deploy|build|env|environment|logs|server|production)\b/i],
  ['database', /\b(database|postgres|prisma|migration|schema|record|db)\b/i],
]

const STRONG_AREA_PATTERNS: Array<[CodyArea, RegExp]> = [
  ['company profile', /\b(company card|company profile|setup gaps?|research(?:ed|ing)? (?:my |the |our )?company|bbb|better business bureau|google reviews?|default terms|payment instructions|warranty text|estimate disclaimer|company logo|brand assets?)\b/i],
  ['onboarding/auth', /\b(setup mode|stuck in onboarding|create workspace|join workspace|invite code|account entry)\b/i],
  ['agent/tools', /\b(narrated operational work|without a valid executable tool call|tool call|tool_call|wrong workflow|misfire)\b/i],
]

const AREA_FILES: Record<CodyArea, string[]> = {
  'uploads/files': [
    'src/app/api/upload/route.ts',
    'src/lib/jobs/document-worker.ts',
    'src/components/jobrolo/document-card.tsx',
    'src/lib/storage.ts',
    'src/lib/file-url.ts',
  ],
  'documents/ocr': [
    'src/app/api/upload/route.ts',
    'src/lib/jobs/document-worker.ts',
    'src/lib/skills/select-skill.ts',
    'src/lib/agent/tools-v2.ts',
    'src/components/jobrolo/document-card.tsx',
  ],
  'onboarding/auth': [
    'src/app/signup/page.tsx',
    'src/app/onboarding/page.tsx',
    'src/app/api/public/entry-chat/route.ts',
    'src/lib/onboarding/research.ts',
    'src/components/jobrolo/onboarding-entry-chat.tsx',
  ],
  shortcuts: [
    'src/components/jobrolo/chat-input.tsx',
    'src/lib/command-shortcuts.ts',
    'src/lib/command-shortcuts-db.ts',
    'src/components/jobrolo/workspace-sidebar.tsx',
  ],
  field: [
    'src/lib/field-copilot.ts',
    'src/lib/property-research.ts',
    'src/lib/property-memory.ts',
    'src/components/jobrolo/field-copilot-drawer.tsx',
    'src/components/jobrolo/canvassing-map.tsx',
  ],
  'company profile': [
    'src/lib/contractor-profile.ts',
    'src/lib/company-intelligence.ts',
    'src/lib/onboarding/research.ts',
    'src/lib/agent/tools-v2.ts',
    'src/components/jobrolo/copilot-cards.tsx',
  ],
  'roof reports': [
    'src/lib/roof-reports.ts',
    'src/components/jobrolo/roof-report-builder.tsx',
    'src/components/jobrolo/copilot-cards.tsx',
  ],
  signatures: [
    'src/lib/final-documents.ts',
    'src/app/api/signatures',
    'src/components/jobrolo/signature',
  ],
  notifications: [
    'src/lib/notifications.ts',
    'src/lib/field-copilot.ts',
    'src/components/jobrolo/copilot-inbox-strip.tsx',
    'src/app/api/notifications',
  ],
  'agent/tools': [
    'src/lib/agent-loop.ts',
    'src/lib/agent/tools-v2.ts',
    'src/lib/prompts.ts',
    'src/lib/skills/select-skill.ts',
  ],
  'security/permissions': [
    'src/lib/security/context.ts',
    'src/lib/security/permissions.ts',
    'src/lib/agent-execution.ts',
    'src/middleware.ts',
  ],
  deployment: [
    'package.json',
    'next.config.ts',
    'src/app/api/health/route.ts',
    'prisma/schema.prisma',
  ],
  database: [
    'prisma/schema.prisma',
    'prisma/migrations',
    'src/lib/db.ts',
    'src/lib/agent/tools-v2.ts',
  ],
  general: [
    'src/lib/agent-loop.ts',
    'src/lib/agent/tools-v2.ts',
    'src/components/jobrolo',
  ],
}

export function inferCodyArea(content: string, fallback?: string | null): CodyArea {
  const normalizedFallback = (fallback ?? '').trim().toLowerCase()
  const known = Object.keys(AREA_FILES).find(area => area === normalizedFallback) as CodyArea | undefined
  for (const [area, pattern] of STRONG_AREA_PATTERNS) {
    if (pattern.test(content)) return area
  }
  if (known) return known
  for (const [area, pattern] of AREA_PATTERNS) {
    if (pattern.test(content)) return area
  }
  return 'general'
}

export function extractCodyFeedbackActivation(text: string): CodyActivation | null {
  const clean = text.trim()
  if (!clean) return null

  const codexMarker = clean.match(/^\s*\(?\s*note\s+to\s+(codex)\s*\)?\s*[:\-–—]?\s*/i)
    ?? clean.match(/^\s*(?:tell|send|save)\s+(?:this\s+)?(?:to|for)\s+(codex)\s*[:\-–—]?\s*/i)
    ?? clean.match(/^\s*(?:tell|send|save)\s+(codex)\s+(?:this\s+)?[:\-–—]?\s*/i)
    ?? clean.match(/^\s*\(?\s*hey\s+(codex)\s*\)?\s*[:,\-–—]?\s*/i)
  if (!codexMarker) return null
  const content = clean.slice(codexMarker[0].length).trim()
  return content ? { audience: 'codex', content } : null
}

export function isCodyBlockOpenText(text: string) {
  const clean = text.trim()
  if (!clean) return false
  const leadingWords = clean.toLowerCase().match(/[a-z]+/g) ?? []
  return leadingWords[0] === 'cody' && leadingWords[1] === 'cody' && leadingWords[2] === 'cody'
}

export function isCodyBlockCloseText(text: string) {
  return /^\s*end\s+cody\b/i.test(text.trim())
}

export function codyBlockOpeningContent(text: string) {
  return text.trim().replace(/^\s*\(?\s*cody\b[\s,.\-–—:;!]*cody\b[\s,.\-–—:;!]*cody\b\s*\)?\s*[:,\-–—]?\s*/i, '').trim()
}

export function inferCodySeverity(content: string, fallback?: string | null): CodySeverity {
  const normalizedFallback = (fallback ?? '').trim().toLowerCase()
  if (['low', 'normal', 'high', 'urgent'].includes(normalizedFallback)) return normalizedFallback as CodySeverity
  if (/\b(p0|urgent|critical|security leak|data leak|private data|production down|cannot log in)\b/i.test(content)) return 'urgent'
  if (/\b(broken|bug|failed|failure|stuck|crash|crashed|error|cannot|can't|wont|won't|loop|frozen|froze|does nothing|nothing happens|approval does nothing)\b/i.test(content)) return 'high'
  if (/\b(ugly|confusing|weird|janky|off|wrong|should)\b/i.test(content)) return 'normal'
  return 'low'
}

function priorityFromSeverity(severity: CodySeverity): CodyPacket['priority'] {
  if (severity === 'urgent') return 'P0'
  if (severity === 'high') return 'P1'
  if (severity === 'normal') return 'P2'
  return 'P3'
}

function compactSummary(content: string) {
  return content.replace(/\s+/g, ' ').trim().slice(0, 240)
}

function expectedForArea(area: CodyArea) {
  switch (area) {
    case 'uploads/files':
      return 'Uploads should save once, classify from user intent/extracted content/context, route to the right company/customer/project bucket, and show usable cards or links.'
    case 'documents/ocr':
      return 'Documents should wait for real extraction when needed, avoid filename-as-content, and only save/import/link after confidence or user confirmation.'
    case 'onboarding/auth':
      return 'Entry/onboarding should feel like Jobrolo chat, answer questions before signup, and route users into the right workspace without trapping them.'
    case 'shortcuts':
      return 'Buttons and shortcut pills should insert editable prompts or open safe cards; they should not silently execute risky work or create tool loops.'
    case 'field':
      return 'Field workflows should capture GPS/context, create leads/inspections deliberately, and keep evidence attached to the right customer/project after confirmation.'
    case 'company profile':
      return 'Company profile actions should separate saved DB truth from public research suggestions and ask before updating brand/legal/profile data.'
    case 'roof reports':
      return 'Roof reports should let users select photos, edit notes/captions, preview/download/share safely, and keep report state connected to the project.'
    case 'signatures':
      return 'Signature flows should preserve audit trails, private storage, token safety, and clear signer/customer permissions.'
    case 'notifications':
      return 'Notifications and approvals should explain what is being approved, complete after approval, and clear/archive cleanly.'
    case 'agent/tools':
      return 'Jobrolo should call executable tools for real work and honestly report failure instead of narrating operations.'
    case 'security/permissions':
      return 'Tenant, role, file, and public/private boundaries should block unauthorized reads and all unsafe mutations.'
    case 'deployment':
      return 'Render/local builds should be repeatable, env-dependent features should fail clearly, and deploy status should be inspectable.'
    case 'database':
      return 'Database records should preserve tenant ownership, correct relationships, and migration safety.'
    default:
      return 'The workflow should be clear, truthful, and connected to saved Jobrolo records.'
  }
}

function fixDirectionForArea(area: CodyArea) {
  switch (area) {
    case 'uploads/files':
      return 'Trace the upload payload, classification result, document worker status, storage URLs, and post-upload link action. Keep classification content-based and avoid auto-linking company assets to customers.'
    case 'documents/ocr':
      return 'Check extraction readiness, document type profiles, pending/imported states, and any tool that passes filenames or document IDs as extracted text.'
    case 'onboarding/auth':
      return 'Trace the entry route, invite/code flow, setup-mode gating, first workspace/chat creation, and whether onboarding state is incorrectly blocking normal navigation.'
    case 'shortcuts':
      return 'Confirm each button either inserts an editable prompt, opens a card, or requests approval with structured metadata. Avoid silent mutation from UI clicks.'
    case 'field':
      return 'Trace browser location capture, field lead creation/conversion, property research provider status, and timeline/evidence attachment.'
    case 'company profile':
      return 'Compare profile DB values against public research output, dedupe sources, and require explicit save for logos/legal/payment/profile fields.'
    case 'roof reports':
      return 'Trace report draft creation, photo selection state, approval requirements, PDF generation, and project/document linkage.'
    case 'notifications':
      return 'Trace InboxItem/action request lifecycle: created → displayed → approved/rejected/actioned/archived. Ensure UI refreshes and status changes after action.'
    case 'agent/tools':
      return 'Inspect deterministic routing, selected tools, tool result handling, and post-tool final answer guardrails.'
    case 'security/permissions':
      return 'Audit tenant filters, role checks, public token routes, file-serving authorization, and mutation tool approval checks.'
    case 'deployment':
      return 'Check Render logs, env vars, build command, Prisma state, storage config, and runtime health endpoints.'
    case 'database':
      return 'Inspect schema relations, query filters, missing indexes/migrations, and whether UI expects fields the API does not return.'
    default:
      return 'Reproduce with the captured chat/context, identify the responsible API/component/tool path, and patch the smallest safe layer.'
  }
}

function safetyNotesForArea(area: CodyArea) {
  const common = [
    'Cody is read-only: do not mutate production data from Cody.',
    'Do not bypass approval gating or tenant isolation.',
    'Do not expose private files, customer data, or hidden debug payloads to public users.',
  ]
  if (area === 'uploads/files' || area === 'documents/ocr') {
    return [...common, 'Do not make uploaded files public to fix rendering.', 'Do not trust filenames or PDF metadata as extracted content.']
  }
  if (area === 'company profile') {
    return [...common, 'Do not overwrite company profile from public research without explicit approval.']
  }
  if (area === 'notifications') {
    return [...common, 'Do not auto-approve destructive or external-send actions.']
  }
  if (area === 'security/permissions') {
    return [...common, 'Treat any cross-tenant or public private-data access as P0 until disproven.']
  }
  return common
}

function testChecklistForArea(area: CodyArea) {
  const common = [
    'Reproduce from the captured chat/app context.',
    'Verify the final answer only claims work that actually completed.',
    'Run TypeScript and the focused affected tests.',
  ]
  switch (area) {
    case 'uploads/files':
      return [
        'Upload a photo, PDF estimate, logo, and price sheet.',
        'Confirm each routes to the correct bucket/card.',
        'Confirm no customer/project attachment happens without the right context or confirmation.',
        ...common,
      ]
    case 'documents/ocr':
      return [
        'Upload a large estimate/scope and wait for extraction.',
        'Ask for summary before and after extraction completes.',
        'Confirm pending state does not fake a save/import.',
        ...common,
      ]
    case 'field':
      return [
        'Start field lead with browser GPS.',
        'Open map and refresh location.',
        'Convert lead to customer/project after approval.',
        'Upload inspection photos and verify tags/context.',
        ...common,
      ]
    case 'company profile':
      return [
        'Show saved company profile from DB.',
        'Research company online and verify suggestions are labeled as public evidence.',
        'Approve updates and re-read profile.',
        ...common,
      ]
    case 'shortcuts':
      return [
        'Tap shortcut/pill and verify it inserts editable text or opens the intended card.',
        'Confirm Enter/mobile behavior still works as designed.',
        ...common,
      ]
    case 'notifications':
      return [
        'Create an approval item.',
        'Approve/reject it and verify status clears/updates.',
        'Refresh and confirm it does not reappear incorrectly.',
        ...common,
      ]
    default:
      return common
  }
}

function evidenceFromInput(input: CodyPacketInput) {
  const evidence: string[] = []
  if (input.company) evidence.push(`Company/workspace: ${input.company}`)
  if (input.appUrl) evidence.push(`App context: ${input.appUrl}`)
  if (input.currentUrl) evidence.push(`Current URL: ${input.currentUrl}`)
  const context = input.debugContext ?? {}
  for (const key of ['conversationId', 'workspaceId', 'chatId', 'channelType', 'userRole']) {
    const value = context[key]
    if (typeof value === 'string' && value) evidence.push(`${key}: ${value}`)
  }
  const docIds = Array.isArray(context.documentIds) ? context.documentIds.filter(value => typeof value === 'string') : []
  if (docIds.length) evidence.push(`Document IDs in current turn: ${docIds.join(', ')}`)
  if (input.recentMessages?.length) evidence.push(`Recent chat turns captured: ${input.recentMessages.length}`)
  return evidence
}

function reproductionStepsFromMessages(messages: CodyPacketInput['recentMessages']) {
  const userMessages = (messages ?? [])
    .filter(message => message?.role === 'user' && message.text)
    .slice(-4)
    .map(message => String(message.text).replace(/\s+/g, ' ').trim())
  if (!userMessages.length) {
    return [
      'Open the related Jobrolo context from the captured app URL.',
      'Repeat the user action described in the note.',
      'Compare actual result to expected behavior.',
    ]
  }
  return userMessages.map((text, index) => `${index + 1}. User said: ${text.slice(0, 220)}`)
}

export function buildCodyPacket(input: CodyPacketInput): CodyPacket {
  const content = input.content.trim()
  const area = inferCodyArea(content, input.area)
  const severity = inferCodySeverity(content, input.severity)
  const priority = priorityFromSeverity(severity)
  const summary = compactSummary(content)
  const evidence = evidenceFromInput(input)
  const expectedBehavior = expectedForArea(area)
  const actualBehavior = summary || 'Tester reported a problem but did not provide details.'
  const likelyFiles = AREA_FILES[area] ?? AREA_FILES.general
  const suggestedFixDirection = fixDirectionForArea(area)
  const safetyNotes = safetyNotesForArea(area)
  const testChecklist = testChecklistForArea(area)
  const title = input.title?.trim() || `Cody Review: ${area}`
  return {
    title,
    priority,
    severity,
    area,
    role: 'read_only_developer_analyst',
    oneSentenceSummary: summary,
    whatICanSee: evidence.length ? evidence : ['Only the tester note is available. Ask for screenshot/chat/log context if needed.'],
    likelyIssue: `Likely ${area} workflow issue based on tester feedback. Confirm with captured chat/log evidence before patching.`,
    expectedBehavior,
    actualBehavior,
    evidence,
    reproductionSteps: reproductionStepsFromMessages(input.recentMessages),
    likelyFiles,
    suggestedFixDirection,
    safetyNotes,
    doNotChange: [
      'Do not let Cody mutate production data.',
      'Do not remove approval gating.',
      'Do not weaken auth, tenant isolation, or file permissions.',
      'Do not turn tester notes into customer/job notes.',
    ],
    testChecklist,
    codexTask: `Investigate and fix the ${area} issue described by the tester. Start with ${likelyFiles.slice(0, 3).join(', ')}. Preserve approvals, tenant isolation, and chat-first behavior.`,
  }
}

export function buildCodyCaptureMessage(input: Pick<CodyPacketInput, 'content' | 'area' | 'severity'>) {
  const area = inferCodyArea(input.content, input.area)
  const severity = inferCodySeverity(input.content, input.severity)
  const priority = priorityFromSeverity(severity)
  return `Captured for Cody as ${priority} ${area}. Cody will review it as read-only developer feedback and package the context for Codex.`
}
