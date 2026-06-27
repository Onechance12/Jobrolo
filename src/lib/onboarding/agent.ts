// =============================================================================
// Onboarding Agent — adaptive, agent-driven onboarding
// =============================================================================
// This is NOT a wizard. It's an agent that:
//   1. Greets the user
//   2. Asks for website/company name
//   3. Runs research if a website is provided
//   4. Presents findings and asks for corrections
//   5. Asks adaptive questions based on business type + missing info
//   6. Tracks confidence score — completes when >= 70
//   7. On completion: writes ContractorMemory, creates channels, marks session done
//
// The agent uses the z-ai chat API with a system prompt that includes:
//   - the conversation so far
//   - the current business profile
//   - the current confidence + what's missing
//   - business-type-specific question suggestions
// =============================================================================

import { db } from '@/lib/db'
import { chatComplete } from '@/lib/ai'
import { researchCompany, type CompanyResearch } from './research'
import { DEFAULT_CHANNELS_BY_WORKSPACE } from '@/lib/channels'
import { upsertContractorProfile } from '@/lib/contractor-profile'

export interface OnboardingMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface BusinessProfile {
  companyName?: string
  website?: string
  phone?: string
  email?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  licenseNumber?: string
  ownerName?: string
  publicContactName?: string
  publicContactTitle?: string
  logoPreference?: string
  description?: string
  businessType?: string  // roofing, restoration, public_adjuster, general_contractor, hvac, plumbing, siding, gutters, painting, electrical, other
  services: string[]
  serviceAreas: string[]
  location?: string
  teamSize?: string
  crewModel?: string  // 'in_house_crews' | 'subcontractors' | 'mixed'
  customerModel?: string  // 'residential' | 'commercial' | 'both'
  workType?: string  // 'retail' | 'insurance' | 'both' (for roofing/restoration)
  softwareUsed: string[]
  goals: string[]
  salesProcess?: string
  productionProcess?: string
  claimProcess?: string
  communicationPrefs?: string
  specialties: string[]
}

// Info categories the agent tracks — each adds to confidence when covered
const INFO_CATEGORIES = [
  'company_identity',     // name, website, description
  'company_contact',      // phone, email, address for estimates/invoices/reports
  'brand_assets',         // logo preference / upload reminder
  'business_type',        // roofing, restoration, etc.
  'services',             // what they do
  'service_area',         // where they work
  'team_size',            // how big
  'crew_model',           // in-house vs subs
  'customer_model',       // resi vs commercial
  'work_type',            // retail vs insurance
  'software',             // tools they use
  'goals',                // what they want from Jobrolo
  'processes',            // sales/production/claim workflows
] as const

// Per-business-type question banks — agent picks from these based on context
const QUESTION_BANKS: Record<string, Array<{ topic: string; question: string }>> = {
  roofing: [
    { topic: 'company_contact', question: "What phone number, email, and business address should show on your estimates, invoices, reports, and customer-facing documents?" },
    { topic: 'brand_assets', question: "Do you want to upload a company logo now for reports and estimates, or skip that for later?" },
    { topic: 'work_type', question: "Are you mostly doing retail roofing (direct to homeowner) or insurance work (storm damage, claims)?" },
    { topic: 'customer_model', question: "Residential, commercial, or both?" },
    { topic: 'crew_model', question: "Do you have in-house crews, or do you use subcontractors?" },
    { topic: 'service_area', question: "What cities or counties do you serve?" },
    { topic: 'software', question: "What software are you using now? (EagleView, Xactimate, AccuLynx, JobNimbus, etc.)" },
    { topic: 'goals', question: "What's the #1 thing you want Jobrolo to help with?" },
  ],
  restoration: [
    { topic: 'company_contact', question: "What phone number, email, and business address should show on your estimates, invoices, reports, and customer-facing documents?" },
    { topic: 'brand_assets', question: "Do you want to upload a company logo now for reports and estimates, or skip that for later?" },
    { topic: 'work_type', question: "Are you doing mostly insurance restoration, or also taking on retail work?" },
    { topic: 'customer_model', question: "Residential, commercial, or both?" },
    { topic: 'crew_model', question: "In-house crews or subcontractors? What trades?" },
    { topic: 'service_area', question: "What's your service area?" },
    { topic: 'software', question: "Using Xactimate? Any PM software like Encircle or DASH?" },
    { topic: 'claim_process', question: "Walk me through how you handle a claim — from first call to final invoice." },
    { topic: 'goals', question: "Where do you lose the most time right now?" },
  ],
  public_adjuster: [
    { topic: 'company_contact', question: "What phone number, email, office address, and license information should show on your client-facing documents?" },
    { topic: 'brand_assets', question: "Do you want to upload a company logo now for reports and documents, or skip that for later?" },
    { topic: 'services', question: "Do you handle residential, commercial, or both? What claim types — property, casualty, wind/hail?" },
    { topic: 'service_area', question: "What states or regions are you licensed in?" },
    { topic: 'team_size', question: "Solo, or do you have a team of adjusters working under you?" },
    { topic: 'software', question: "What software do you use for claims? Xactimate, Symbility, ClaimXperience?" },
    { topic: 'processes', question: "How do you currently track claim status across carriers?" },
    { topic: 'goals', question: "What would make your life easier day-to-day?" },
  ],
  general_contractor: [
    { topic: 'company_contact', question: "What phone number, email, and business address should show on estimates, invoices, reports, and customer-facing documents?" },
    { topic: 'brand_assets', question: "Do you want to upload a company logo now for reports and estimates, or skip that for later?" },
    { topic: 'services', question: "What trades do you cover? Kitchen/bath, additions, whole-home, disaster recovery?" },
    { topic: 'customer_model', question: "Residential, commercial, or both?" },
    { topic: 'crew_model', question: "In-house crews, or do you sub out trades?" },
    { topic: 'service_area', question: "Where do you operate?" },
    { topic: 'software', question: "Using BuilderTrend, CoConstruct, Procore, or anything else?" },
    { topic: 'goals', question: "What's the biggest bottleneck in your operation right now?" },
  ],
  hvac: [
    { topic: 'company_contact', question: "What phone number, email, and business address should show on estimates, invoices, reports, and customer-facing documents?" },
    { topic: 'brand_assets', question: "Do you want to upload a company logo now for reports and estimates, or skip that for later?" },
    { topic: 'services', question: "Residential install, commercial service, or both? Do you do new construction or replacement/retrofit?" },
    { topic: 'crew_model', question: "Employed techs or subcontractors?" },
    { topic: 'service_area', question: "What's your service area?" },
    { topic: 'software', question: "Using ServiceTitan, Housecall Pro, FieldEdge?" },
    { topic: 'goals', question: "What do you want Jobrolo to help with?" },
  ],
  default: [
    { topic: 'company_contact', question: "What phone number, email, and business address should show on estimates, invoices, reports, and customer-facing documents?" },
    { topic: 'brand_assets', question: "Do you want to upload a company logo now for reports and estimates, or skip that for later?" },
    { topic: 'services', question: "What services do you offer?" },
    { topic: 'service_area', question: "What area do you serve?" },
    { topic: 'team_size', question: "How big is your team?" },
    { topic: 'software', question: "What software do you currently use to run the business?" },
    { topic: 'goals', question: "What's the #1 thing you want Jobrolo to help with?" },
  ],
}

const COMPLETION_THRESHOLD = 70
const AUTO_COMPLETE_THRESHOLD = 80  // above this, we push to complete aggressively

// ---------------------------------------------------------------------------
// Keyword-based topic auto-detection
// ---------------------------------------------------------------------------
// Scans user messages for key terms and auto-marks topics as covered.
// This prevents the agent from asking "what software do you use?" when the
// user already said "we use AccuLynx" three messages ago.
// ---------------------------------------------------------------------------

const TOPIC_KEYWORDS: Record<string, string[]> = {
  company_contact: ['phone', 'email', 'address', 'office', 'business address', 'mailing address', 'estimates', 'invoices', 'reports'],
  brand_assets: ['logo', 'brand', 'branding', 'skip logo', 'upload logo', 'later'],
  software: ['acculynx', 'xactimate', 'jobnimbus', 'servicetitan', 'housecall', 'fieldedge', 'procore', 'buildertrend', 'coconstruct', 'accu lynx', 'eagleview', 'symbility', 'claimxperience', 'encircle', 'dash', 'horizon'],
  crew_model: ['subcontractor', 'sub contractor', 'subs', 'in-house', 'in house', 'inhouse', 'w-2', 'w2', '1099', 'employees', 'employed'],
  customer_model: ['residential', 'commercial', 'homeowner', 'home owner', 'resi'],
  work_type: ['insurance', 'retail work', 'storm damage', 'storm restoration', 'carrier', 'adjuster', 'supplement', 'direct to consumer', 'out of pocket'],
  team_size: ['sales reps', 'sales rep', 'team of', 'people', 'just me', 'solo', 'staff of', 'employees', 'guys', 'myself and'],
  service_area: ['serve', 'serving', 'service area', 'dallas', 'fort worth', 'houston', 'austin', 'san antonio', 'chicago', 'denver', 'atlanta', 'nashville', 'knoxville', 'northeast', 'southwest', 'midwest', 'west coast', 'east coast', 'texas', 'florida', 'california', 'new jersey', 'new york', 'pennsylvania', 'connecticut'],
  goals: ['want to', 'need to', 'looking for', 'hoping to', 'trying to', 'less time', 'save time', 'streamline', 'automate', 'frustrated', 'struggle', 'bottleneck', 'challenge', 'problem with'],
  services: ['storm restoration', 'roof replacement', 'roof repair', 'roof installation', 'roofing contractor', 'gutter installation', 'gutter repair', 'siding', 'window', 'hail damage', 'wind damage', 'storm damage', 'leak repair', 'roof inspection', 'tear off', 'tearoff', 'emergency roof'],
  processes: ['sales process', 'production process', 'claim process', 'workflow', 'from start to finish', 'lead to close', 'step by step', 'first we', 'then we', 'inspect roofs', 'file claims'],
}

function detectCoveredTopics(message: string): string[] {
  const lower = ' ' + message.toLowerCase() + ' '
  const detected: string[] = []
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    // Use word-boundary-aware matching: check that the keyword is surrounded by
    // non-alphanumeric characters (space, punctuation, start/end) to avoid
    // matching "roof" inside "sonsroofs.com"
    if (keywords.some(kw => {
      const pattern = new RegExp(`(^|[^a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i')
      return pattern.test(lower)
    })) {
      detected.push(topic)
    }
  }
  return detected
}

// ---------------------------------------------------------------------------
// Confirmation-phrase detection — when user confirms "ready to set up?"
// ---------------------------------------------------------------------------

const CONFIRMATION_PHRASES = [
  'yes', 'yep', 'yeah', 'yup', 'sure', 'ok', 'okay', 'sounds good', 'sounds great',
  'go ahead', 'do it', 'lets do it', "let's do it", 'perfect', 'thats right', "that's right",
  'correct', 'exactly', 'right', 'affirmative', 'please', 'go for it', 'im ready', "i'm ready",
  'ready', 'lets go', "let's go", 'hit it', 'make it happen', 'proceed',
]

function isConfirmation(message: string): boolean {
  const lower = message.toLowerCase().trim()
  // Exact match or starts with confirmation phrase
  return CONFIRMATION_PHRASES.some(phrase => lower === phrase || lower.startsWith(phrase + ' ') || lower.startsWith(phrase + '.') || lower.startsWith(phrase + '!'))
}

// Detect if the agent's last message was offering to complete / set up
function agentOfferedToComplete(history: OnboardingMessage[]): boolean {
  const lastAgentMessages = history.filter(m => m.role === 'assistant').slice(-2)
  const text = lastAgentMessages.map(m => m.content.toLowerCase()).join(' ')
  return /ready to set up|set up your workspace|set up your jobrolo|i'll create your|i will create your|ready to get started|shall we|want me to|should i|i have everything i need|got everything|i have all (the info|the information)/.test(text)
}

// ---------------------------------------------------------------------------
// System prompt builder — gives the AI everything it needs to act as the agent
// ---------------------------------------------------------------------------

function buildSystemPrompt(args: {
  userName: string
  profile: BusinessProfile
  research: CompanyResearch | null
  coveredTopics: string[]
  confidence: number
  businessType: string | null
  history: OnboardingMessage[]
}): string {
  const { userName, profile, research, coveredTopics, confidence, businessType, history } = args

  const profileJson = JSON.stringify(profile, null, 2)
  const researchJson = research ? JSON.stringify({
    website: research.website,
    companyName: research.companyName,
    description: research.description,
    services: research.services,
    serviceAreas: research.serviceAreas,
    location: research.location,
    businessType: research.businessType,
    teamSizeEstimate: research.teamSizeEstimate,
    socialProfiles: research.socialProfiles,
  }, null, 2) : 'null'

  // Available questions based on business type
  const questionBank = QUESTION_BANKS[businessType ?? 'default'] ?? QUESTION_BANKS.default
  const availableQuestions = questionBank
    .filter(q => !coveredTopics.includes(q.topic))
    .map(q => `  - [${q.topic}] ${q.question}`)
    .join('\n')

  // What's missing
  const missing = INFO_CATEGORIES.filter(c => !coveredTopics.includes(c))

  return `You are Jobrolo's onboarding agent — an AI operations manager onboarding a new contractor named ${userName}.

YOUR GOAL: Learn enough about ${userName}'s business to set up their Jobrolo workspace. You're their new operations manager — act like one. Conversational, warm, curious. NOT a form. NOT a wizard.

IMPORTANT: The user's name is "${userName}". Always use this name. Do NOT call them "Mike" or any other name.

COMPANY PROFILE GOAL: Jobrolo uses the company profile on estimates, invoices, roof reports, contracts, signatures, and customer-facing documents. During onboarding, collect or confirm the public-facing company/display name, website, business phone, email, business address, license/insurance details if relevant, public contact, and logo preference. Logo is optional: if they do not have one ready, mark brand_assets covered and tell them they can upload it later.

CURRENT STATE:
- Business profile so far:
${profileJson}

- Research findings (from their website, if any):
${researchJson}

- Topics already covered (DO NOT ASK ABOUT THESE AGAIN): ${coveredTopics.length ? coveredTopics.join(', ') : '(none yet)'}
- Topics still missing: ${missing.length ? missing.join(', ') : '(all covered)'}
- Confidence score: ${confidence}/100 (completion threshold: ${COMPLETION_THRESHOLD})
- Messages so far: ${history.length}

CONVERSATION HISTORY:
${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

CRITICAL RULES (read carefully):
1. DO NOT ASK ABOUT ANY TOPIC IN "already covered". If "software" is covered, do NOT ask about software. If "goals" is covered, do NOT ask about goals. Period.
2. READ the user's last message carefully. If they already answered your next question in that message, acknowledge it and move on — don't ask it again.
3. Ask ONLY ONE question per turn. Never list multiple questions.
4. Keep responses SHORT — 1-2 sentences of acknowledgment + ONE question. Max 3 sentences total.
5. If the user says you already asked something ("we already talked about this"), APOLOGIZE briefly and either ask about a genuinely missing topic or move to completion.
6. When confidence >= ${COMPLETION_THRESHOLD} OR you understand their business well, STOP asking questions. Tell them you're ready to set up their workspace, briefly list what you'll create (1 sentence), and ask "Ready to get started?" — then WAIT for their confirmation. Do NOT say "I have all the information needed" unless you are ACTUALLY asking to complete — if you say it, you MUST also ask "Ready to get started?" and set shouldComplete to true on the NEXT turn when they confirm.
7. When the user confirms ("yes", "yep", "go ahead", "sounds good"), set shouldComplete: true.
8. NEVER mention "confidence score", "topics", "covered", or "profile" to the user — speak naturally.
9. NEVER ask "what's your workflow?" or "walk me through your process" as a vague catch-all — that's lazy. Ask specific questions only.
10. If all key topics are covered, DON'T keep asking filler questions. Move to completion immediately.
11. DO NOT say "I have all the information needed" or "I have most of what I need" unless you are ACTUALLY ready to complete. If you say this, you must ask "Ready to get started?" in the same message.
12. The user's name is "${userName}". Use ONLY this name. Never "Mike" or any other name.
13. If the user gives company contact details, extract them into phone, email, addressLine1, city, state, postalCode, licenseNumber, publicContactName, or publicContactTitle when possible.
14. Do NOT require a logo to complete onboarding. If the user says to skip it, add "brand_assets" to newlyCoveredTopics and store logoPreference: "skip_for_now".

AVAILABLE QUESTION BANK (only use for topics NOT yet covered — adapt wording, don't copy verbatim):
${availableQuestions || '(all topics covered — move to completion)'}

Respond as JSON only (no markdown fences):
{
  "message": "your conversational response (short, 1-3 sentences)",
  "extractedInfo": {},
  "newlyCoveredTopics": ["topic1", "topic2"],
  "shouldComplete": false
}

Set "shouldComplete": true when the user has confirmed they're ready for you to set up the workspace.`
}

// ---------------------------------------------------------------------------
// Extract structured info from the user's reply using the AI's response
// ---------------------------------------------------------------------------

function mergeProfile(existing: BusinessProfile, extracted: Partial<BusinessProfile>): BusinessProfile {
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(extracted).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
    ),
  }
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenced?.[1]?.trim() || trimmed

  if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate

  const start = candidate.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return candidate.slice(start, i + 1)
    }
  }
  return null
}

function normalizeAiResponse(raw: string): { message: string; extractedInfo: Partial<BusinessProfile>; newlyCoveredTopics: string[]; shouldComplete: boolean } {
  const json = extractJsonObject(raw)
  if (json) {
    try {
      const parsed = JSON.parse(json)
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return {
          message: parsed.message.trim(),
          extractedInfo: parsed.extractedInfo && typeof parsed.extractedInfo === 'object' ? parsed.extractedInfo : {},
          newlyCoveredTopics: Array.isArray(parsed.newlyCoveredTopics) ? parsed.newlyCoveredTopics.filter((t: unknown) => typeof t === 'string') : [],
          shouldComplete: Boolean(parsed.shouldComplete),
        }
      }
      console.warn('[onboarding] AI JSON missing message', {
        keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
      })
    } catch (err) {
      console.warn('[onboarding] AI JSON parse failed:', err instanceof Error ? err.message : String(err))
    }
  } else {
    console.warn('[onboarding] AI JSON object not found')
  }

  const fallbackText = raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()

  if (fallbackText) {
    console.warn('[onboarding] using non-JSON AI text response', {
      preview: fallbackText.slice(0, 500),
    })
    return {
      message: fallbackText.slice(0, 1000),
      extractedInfo: {},
      newlyCoveredTopics: [],
      shouldComplete: false,
    }
  }

  throw new Error('AI returned empty or unusable onboarding response')
}

// ---------------------------------------------------------------------------
// Recalculate confidence based on profile completeness
// ---------------------------------------------------------------------------

function calculateConfidence(profile: BusinessProfile, coveredTopics: string[]): number {
  let score = 0
  if (profile.companyName) score += 10
  if (profile.website) score += 5
  if (profile.phone || profile.email || profile.addressLine1 || profile.location) score += 8
  if (profile.logoPreference) score += 3
  if (profile.description) score += 5
  if (profile.businessType) score += 15  // critical — drives question selection
  if (profile.services.length > 0) score += 10
  if (profile.serviceAreas.length > 0) score += 10
  if (profile.location) score += 5
  if (profile.teamSize) score += 8
  if (profile.crewModel) score += 10
  if (profile.customerModel) score += 7
  if (profile.workType) score += 8
  if (profile.softwareUsed.length > 0) score += 7
  if (profile.goals.length > 0) score += 10
  if (profile.salesProcess || profile.productionProcess || profile.claimProcess) score += 5
  // Bonus for each covered topic — this is the key driver
  // 8 points per topic, max 64 — so covering 8 topics gets you most of the way
  score += Math.min(64, coveredTopics.length * 8)
  return Math.min(100, score)
}

// ---------------------------------------------------------------------------
// On completion — write to memory + create channels
// ---------------------------------------------------------------------------

async function finalizeOnboarding(contractorId: string, profile: BusinessProfile, businessType: string): Promise<void> {
  // 1. Write ContractorMemory entries for everything we learned
  const memoryEntries: Array<{ category: string; content: string }> = []
  if (profile.companyName) memoryEntries.push({ category: 'default', content: `Company name: ${profile.companyName}` })
  if (profile.website) memoryEntries.push({ category: 'default', content: `Website: ${profile.website}` })
  if (profile.phone) memoryEntries.push({ category: 'default', content: `Company phone: ${profile.phone}` })
  if (profile.email) memoryEntries.push({ category: 'default', content: `Company email: ${profile.email}` })
  if (profile.addressLine1) memoryEntries.push({ category: 'default', content: `Company address: ${[profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.postalCode].filter(Boolean).join(', ')}` })
  if (profile.licenseNumber) memoryEntries.push({ category: 'default', content: `Company license: ${profile.licenseNumber}` })
  if (profile.publicContactName || profile.publicContactTitle) memoryEntries.push({ category: 'default', content: `Public contact: ${[profile.publicContactName, profile.publicContactTitle].filter(Boolean).join(' · ')}` })
  if (profile.logoPreference) memoryEntries.push({ category: 'preference', content: `Company logo preference: ${profile.logoPreference}` })
  if (profile.description) memoryEntries.push({ category: 'default', content: `Description: ${profile.description}` })
  if (profile.businessType) memoryEntries.push({ category: 'preference', content: `Business type: ${profile.businessType}` })
  if (profile.services.length) memoryEntries.push({ category: 'preference', content: `Services: ${profile.services.join(', ')}` })
  if (profile.serviceAreas.length) memoryEntries.push({ category: 'preference', content: `Service areas: ${profile.serviceAreas.join(', ')}` })
  if (profile.location) memoryEntries.push({ category: 'default', content: `Location: ${profile.location}` })
  if (profile.teamSize) memoryEntries.push({ category: 'default', content: `Team size: ${profile.teamSize}` })
  if (profile.crewModel) memoryEntries.push({ category: 'preference', content: `Crew model: ${profile.crewModel}` })
  if (profile.customerModel) memoryEntries.push({ category: 'preference', content: `Customer model: ${profile.customerModel}` })
  if (profile.workType) memoryEntries.push({ category: 'preference', content: `Work type: ${profile.workType}` })
  if (profile.softwareUsed.length) memoryEntries.push({ category: 'preference', content: `Software stack: ${profile.softwareUsed.join(', ')}` })
  if (profile.goals.length) memoryEntries.push({ category: 'preference', content: `Goals: ${profile.goals.join('; ')}` })
  if (profile.specialties.length) memoryEntries.push({ category: 'preference', content: `Specialties: ${profile.specialties.join(', ')}` })
  if (profile.salesProcess) memoryEntries.push({ category: 'policy', content: `Sales process: ${profile.salesProcess}` })
  if (profile.productionProcess) memoryEntries.push({ category: 'policy', content: `Production process: ${profile.productionProcess}` })
  if (profile.claimProcess) memoryEntries.push({ category: 'policy', content: `Claim process: ${profile.claimProcess}` })
  if (profile.communicationPrefs) memoryEntries.push({ category: 'preference', content: `Communication preferences: ${profile.communicationPrefs}` })

  await upsertContractorProfile(contractorId, {
    companyName: profile.companyName,
    displayName: profile.companyName,
    website: profile.website,
    phone: profile.phone,
    email: profile.email,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postalCode,
    country: profile.country,
    licenseNumber: profile.licenseNumber,
    ownerName: profile.ownerName,
    publicContactName: profile.publicContactName,
    publicContactTitle: profile.publicContactTitle,
    metadata: {
      onboarding: {
        description: profile.description,
        businessType: profile.businessType,
        services: profile.services,
        serviceAreas: profile.serviceAreas,
        location: profile.location,
        teamSize: profile.teamSize,
        crewModel: profile.crewModel,
        customerModel: profile.customerModel,
        workType: profile.workType,
        softwareUsed: profile.softwareUsed,
        goals: profile.goals,
        specialties: profile.specialties,
        logoPreference: profile.logoPreference,
      },
    },
  }).catch(err => {
    console.warn('[onboarding] contractor profile save failed:', err instanceof Error ? err.message : String(err))
  })

  for (const entry of memoryEntries) {
    await db.contractorMemory.create({
      data: { contractorId, category: entry.category, content: entry.content, source: 'ai' },
    }).catch(() => {})
  }

  // 2. Update the Contractor record with company name if we have it
  if (profile.companyName) {
    await db.contractor.update({
      where: { id: contractorId },
      data: { company: profile.companyName },
    }).catch(() => {})
  }

  // 3. Create recommended channels based on business type
  //    Find the contractor's workspace, then add channels that don't exist yet
  const workspace = await db.workspace.findFirst({
    where: { contractorId, status: 'active' },
    include: { chats: { select: { chatType: true } } },
  })
  if (workspace) {
    const existingChatTypes = new Set(workspace.chats.map(c => c.chatType))
    const recommendedChannels = DEFAULT_CHANNELS_BY_WORKSPACE['project'] ?? ['main', 'management']
    // Business-type-specific channel additions
    if (businessType === 'roofing' || businessType === 'restoration') {
      recommendedChannels.push('customer', 'crew', 'supplier', 'finance', 'insurance')
    } else if (businessType === 'public_adjuster') {
      recommendedChannels.push('customer', 'insurance', 'sales')
    } else {
      recommendedChannels.push('customer', 'finance', 'sales')
    }
    const uniqueChannels = [...new Set(recommendedChannels)]
    for (const chatType of uniqueChannels) {
      if (!existingChatTypes.has(chatType)) {
        await db.workspaceChat.create({
          data: {
            workspaceId: workspace.id,
            chatType,
            title: String(chatType).charAt(0).toUpperCase() + String(chatType).slice(1),
          },
        }).catch(() => {})
      }
    }
    // Rename the workspace to the company name if we have one
    if (profile.companyName) {
      await db.workspace.update({
        where: { id: workspace.id },
        data: { name: profile.companyName },
      }).catch(() => {})
    }
  }

  console.log(`[onboarding] finalized for contractor ${contractorId}: ${memoryEntries.length} memory entries, channels created`)
}

// ---------------------------------------------------------------------------
// Main entry: process a user message in the onboarding conversation
// ---------------------------------------------------------------------------

export interface OnboardingTurnResult {
  agentMessage: string
  confidence: number
  shouldComplete: boolean
  completed: boolean
  researchRan: boolean
}

export async function processOnboardingTurn(args: {
  contractorId: string
  userId: string
  userMessage: string
}): Promise<OnboardingTurnResult> {
  const { contractorId, userId, userMessage } = args

  // Load or create the onboarding session
  let session = await db.onboardingSession.findUnique({ where: { contractorId } })
  if (!session) {
    session = await db.onboardingSession.create({
      data: { contractorId, userId, status: 'in_progress' },
    })
  }

  // Parse state
  let history: OnboardingMessage[] = JSON.parse(session.messagesJson || '[]')
  let profile: BusinessProfile = session.businessProfile ? JSON.parse(session.businessProfile) : {
    services: [], serviceAreas: [], softwareUsed: [], goals: [], specialties: [],
  }
  let research: CompanyResearch | null = session.researchJson ? JSON.parse(session.researchJson) : null
  let coveredTopics: string[] = JSON.parse(session.coveredTopics || '[]')
  let businessType: string | null = session.businessType

  // Add user message to history
  history.push({ role: 'user', content: userMessage, timestamp: new Date().toISOString() })

  // ----- Trigger research if user provided a website or company name in first few messages -----
  let researchRan = false
  let userProvidedWebsiteOrCompany = false
  if (history.length <= 3 && !research) {
    const websiteMatch = userMessage.match(/https?:\/\/[^\s]+|[a-z0-9.-]+\.(com|net|org|io|co|us|biz|info)/i)
    const website = websiteMatch?.[0]
    let companyName = profile.companyName
    if (!companyName) {
      // If user said "my company is X" or similar, extract
      const nameMatch = userMessage.match(/(?:company|business)\s+(?:is\s+|called\s+)?["']?([A-Z][a-zA-Z0-9\s&.,'-]{2,50})/)
      if (nameMatch) companyName = nameMatch[1].trim()
    }
    // Also check if the user's message contains a business-like name (2+ capitalized words)
    if (!companyName && history.length === 1) {
      const words = userMessage.trim().split(/\s+/)
      if (words.length >= 2 && words[0][0] === words[0][0].toUpperCase()) {
        // Heuristic: if the first word is capitalized and there's no question mark, treat as company name
        companyName = userMessage.replace(/https?:\/\/[^\s]+|[a-z0-9.-]+\.(com|net|org|io|co|us|biz|info)/i, '').trim()
      }
    }
    if (website || companyName) {
      userProvidedWebsiteOrCompany = true
      console.log(`[onboarding] triggering research: website=${website}, company=${companyName}`)
      research = await researchCompany({ website, companyName })
      researchRan = true
      if (research) {
        // Merge research into profile
        if (research.companyName && !profile.companyName) profile.companyName = research.companyName
        if (research.website && !profile.website) profile.website = research.website
        if (research.description && !profile.description) profile.description = research.description
        if (research.businessType && !profile.businessType) {
          profile.businessType = research.businessType
          businessType = research.businessType
        }
        if (research.services.length && profile.services.length === 0) profile.services = research.services
        if (research.serviceAreas.length && profile.serviceAreas.length === 0) profile.serviceAreas = research.serviceAreas
        if (research.location && !profile.location) profile.location = research.location
        if (research.teamSizeEstimate && !profile.teamSize) profile.teamSize = research.teamSizeEstimate
        // Mark some topics as covered based on research
        if (research.companyName || research.website) coveredTopics = [...new Set([...coveredTopics, 'company_identity'])]
        if (research.businessType) coveredTopics = [...new Set([...coveredTopics, 'business_type'])]
        if (research.services.length) coveredTopics = [...new Set([...coveredTopics, 'services'])]
        if (research.serviceAreas.length) coveredTopics = [...new Set([...coveredTopics, 'service_area'])]
        if (research.teamSizeEstimate) coveredTopics = [...new Set([...coveredTopics, 'team_size'])]
      } else {
        // Research failed (website not fetchable) — still record what the user told us
        if (companyName && !profile.companyName) profile.companyName = companyName
        if (website && !profile.website) profile.website = website
        coveredTopics = [...new Set([...coveredTopics, 'company_identity'])]
        console.log(`[onboarding] research failed — using user-provided info: company=${companyName}, website=${website}`)
      }
    }
  }

  // ----- If this is the very first message AND the user did NOT provide a website/company, send the generic greeting -----
  // (If they did provide one, skip the greeting and go straight to the AI conversation)
  if (history.length === 1 && !userProvidedWebsiteOrCompany) {
    const greeting = "Welcome to Jobrolo. I'm going to learn your business and build your workspace.\n\nWhat's your company website or business name?"
    history.push({ role: 'assistant', content: greeting, timestamp: new Date().toISOString() })

    // Persist state
    await db.onboardingSession.update({
      where: { id: session.id },
      data: {
        messagesJson: JSON.stringify(history),
        businessProfile: JSON.stringify(profile),
        researchJson: research ? JSON.stringify(research) : null,
        coveredTopics: JSON.stringify(coveredTopics),
        businessType,
        confidence: calculateConfidence(profile, coveredTopics),
      },
    })

    return {
      agentMessage: greeting,
      confidence: calculateConfidence(profile, coveredTopics),
      shouldComplete: false,
      completed: false,
      researchRan,
    }
  }

  // ----- Call the AI agent to generate a response -----
  const confidence = calculateConfidence(profile, coveredTopics)
  const systemPrompt = buildSystemPrompt({
    userName: (await db.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? 'there',
    profile,
    research,
    coveredTopics,
    confidence,
    businessType,
    history,
  })

  let aiResponse: { message: string; extractedInfo: Partial<BusinessProfile>; newlyCoveredTopics: string[]; shouldComplete: boolean }
  try {
    const raw = await chatComplete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ], { temperature: 0.4, maxTokens: 800 })

    console.log('[onboarding] AI raw response preview:', raw.slice(0, 500))
    aiResponse = normalizeAiResponse(raw)
  } catch (err) {
    console.error('[onboarding] AI call failed:', err)
    aiResponse = {
      message: "I'm sorry, I had trouble processing that. Could you tell me a bit more about your business?",
      extractedInfo: {},
      newlyCoveredTopics: [],
      shouldComplete: false,
    }
  }

  // Merge extracted info
  if (aiResponse.extractedInfo && Object.keys(aiResponse.extractedInfo).length > 0) {
    profile = mergeProfile(profile, aiResponse.extractedInfo)
    if (profile.businessType && !businessType) businessType = profile.businessType
  }

  // Update covered topics — combine AI-detected + keyword-detected
  const keywordDetected = detectCoveredTopics(userMessage)
  const allNewTopics = [...(aiResponse.newlyCoveredTopics ?? []), ...keywordDetected]
  if (allNewTopics.length) {
    coveredTopics = [...new Set([...coveredTopics, ...allNewTopics])]
    console.log(`[onboarding] topics covered: ${allNewTopics.join(', ')} (total: ${coveredTopics.length})`)
  }

  // Also detect what topic the AGENT is asking about from its response —
  // add it to coveredTopics so it won't ask the same question again next turn.
  // This prevents the "What area do you serve?" × 3 problem.
  const agentAskingAbout = detectCoveredTopics(aiResponse.message)
  if (agentAskingAbout.length) {
    const newAgentTopics = agentAskingAbout.filter(t => !coveredTopics.includes(t))
    if (newAgentTopics.length) {
      coveredTopics = [...new Set([...coveredTopics, ...newAgentTopics])]
      console.log(`[onboarding] agent asked about: ${newAgentTopics.join(', ')} (marking as covered to prevent repeat)`)
    }
  }

  // Add agent response to history
  history.push({ role: 'assistant', content: aiResponse.message, timestamp: new Date().toISOString() })

  // Recalculate confidence
  const newConfidence = calculateConfidence(profile, coveredTopics)

  // ----- Check for completion (4 paths) -----
  let completed = false

  // Path 1: AI explicitly said shouldComplete + confidence is high enough + at least 3 turns
  // Path 2: Agent already offered to complete ("ready to set up?") + user confirmed ("yes", "yep", "go ahead")
  // Path 3: Confidence is very high (>= AUTO_COMPLETE_THRESHOLD) + user confirmed + at least 4 turns
  // Path 4: Confidence reached 100 after enough turns — avoid trapping users in a question loop at 100%
  // (Minimum turn counts prevent premature completion on the first message)
  const userConfirmed = isConfirmation(userMessage)
  const agentOffered = agentOfferedToComplete(history.slice(0, -1)) // exclude the just-added agent message
  const turnCount = history.filter(m => m.role === 'user').length
  const confidenceComplete = newConfidence >= 100 && turnCount >= 4

  if ((aiResponse.shouldComplete && newConfidence >= COMPLETION_THRESHOLD && turnCount >= 3) ||
      (agentOffered && userConfirmed && newConfidence >= COMPLETION_THRESHOLD) ||
      (userConfirmed && newConfidence >= AUTO_COMPLETE_THRESHOLD && turnCount >= 4) ||
      confidenceComplete) {
    console.log(`[onboarding] completing for contractor ${contractorId} (confidence: ${newConfidence}, turns: ${turnCount}, path: ${aiResponse.shouldComplete ? 'ai_flag' : agentOffered ? 'agent_offered+confirm' : confidenceComplete ? 'confidence_100' : 'auto_high_confidence'})`)

    // If the AI didn't write a completion message, generate one
    if (!aiResponse.shouldComplete && (agentOffered || confidenceComplete)) {
      aiResponse.message = `Perfect — setting up your Jobrolo workspace now. I've learned your business and I'm ready to go. You'll be in your dashboard in just a moment.`
      // Update the last history message with the completion message
      history[history.length - 1] = { role: 'assistant', content: aiResponse.message, timestamp: new Date().toISOString() }
    }

    await finalizeOnboarding(contractorId, profile, businessType ?? 'other')
    await db.onboardingSession.update({
      where: { id: session.id },
      data: { status: 'completed', completedAt: new Date() },
    })
    completed = true
  }

  // Persist state
  await db.onboardingSession.update({
    where: { id: session.id },
    data: {
      messagesJson: JSON.stringify(history.slice(-30)),  // keep last 30 messages to avoid bloat
      businessProfile: JSON.stringify(profile),
      researchJson: research ? JSON.stringify(research) : null,
      coveredTopics: JSON.stringify(coveredTopics),
      businessType,
      confidence: newConfidence,
    },
  })

  return {
    agentMessage: aiResponse.message,
    confidence: newConfidence,
    shouldComplete: aiResponse.shouldComplete,
    completed,
    researchRan,
  }
}

// ---------------------------------------------------------------------------
// Get the initial greeting (used when user first lands on /onboarding)
// ---------------------------------------------------------------------------

export async function getInitialGreeting(contractorId: string, userId: string): Promise<{ message: string; history: OnboardingMessage[] }> {
  let session = await db.onboardingSession.findUnique({ where: { contractorId } })
  if (!session) {
    session = await db.onboardingSession.create({
      data: { contractorId, userId, status: 'in_progress' },
    })
  }

  let history: OnboardingMessage[] = JSON.parse(session.messagesJson || '[]')

  if (history.length === 0) {
    const greeting = "Welcome to Jobrolo. I'm going to learn your business and build your workspace.\n\nWhat's your company website or business name?"
    history = [{ role: 'assistant', content: greeting, timestamp: new Date().toISOString() }]
    await db.onboardingSession.update({
      where: { id: session.id },
      data: { messagesJson: JSON.stringify(history) },
    })
    return { message: greeting, history }
  }

  return { message: history[history.length - 1].content, history }
}
