import { db } from '@/lib/db'
import { getOrCreateContractorProfile, publicContractorProfile } from '@/lib/contractor-profile'
import { researchCompany, type CompanyResearch, type CompanyWebPresence } from '@/lib/onboarding/research'
import { isOpenAIWebSearchConfigured, type WebSearchSource } from '@/lib/openai-web-search'

export type CompanyResearchMode = 'cheap' | 'normal' | 'deep'

export type CompanyKpiSnapshot = {
  periodDays: number
  generatedAt: string
  leads: {
    total: number
    thisPeriod: number
    previousPeriod: number
    new: number
    inspectionSet: number
    converted: number
  }
  customers: {
    total: number
    addedThisPeriod: number
  }
  projects: {
    total: number
    active: number
    addedThisPeriod: number
  }
  appointments: {
    upcoming14Days: number
    inspectionsUpcoming14Days: number
  }
  files: {
    documentsThisPeriod: number
    photosThisPeriod: number
    estimates: number
    priceSheets: number
    priceSheetsPendingReview: number
  }
  operations: {
    pendingActions: number
    activeInsights: number
    failedOrReviewItems: number
  }
  usage: {
    aiCallsThisMonth: number
    webSearchCallsThisMonth: number
    estimatedCostThisMonth: number | null
  }
}

export type CompanyIntelligenceSnapshot = {
  cardType: 'company_intelligence'
  status: 'snapshot' | 'researched' | 'needs_setup'
  generatedAt: string
  searchMode?: CompanyResearchMode
  usageNote?: string
  analyticsNote: string
  profile: ReturnType<typeof publicContractorProfile>
  profileReadiness: {
    score: number
    missing: string[]
  }
  kpis: CompanyKpiSnapshot
  publicPresence?: {
    researched: boolean
    provider?: string
    summary?: string
    companyName?: string
    website?: string
    logoUrl?: string
    phone?: string
    email?: string
    googleReviews?: CompanyWebPresence['googleReviews']
    reviews?: CompanyWebPresence['reviews']
    bbb?: CompanyWebPresence['bbb']
    socialProfiles?: Record<string, string>
    socialSignals?: Array<{ platform?: string; url?: string; status?: string; notes?: string; recentActivity?: string }>
    contentSignals?: Array<{ channel?: string; title?: string; url?: string; notes?: string }>
    directoryListings?: CompanyWebPresence['directoryListings']
    mentions?: CompanyWebPresence['mentions']
    warnings?: string[]
    sources: WebSearchSource[]
    error?: string
  }
  recommendations: Array<{
    title: string
    detail: string
    prompt: string
    priority: 'high' | 'normal' | 'low'
  }>
  profileSuggestions?: Record<string, unknown>
}

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function safeParseJson<T = any>(value?: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function publicSources(research?: CompanyResearch | null): WebSearchSource[] {
  const webPresence = research?.webPresence
  const sources = [
    ...(webPresence?.sources ?? []),
    ...(webPresence?.mentions ?? []),
    ...(webPresence?.directoryListings ?? []),
    ...(webPresence?.backlinksOrBlogs ?? []),
  ] as WebSearchSource[]
  const seen = new Set<string>()
  return sources.filter(source => {
    const key = source.url || `${source.title}:${source.snippet}`
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 12)
}

function profileReadiness(profile: any) {
  const checks = [
    ['company name', profile?.displayName || profile?.companyName || profile?.legalName],
    ['phone', profile?.phone],
    ['email', profile?.email],
    ['website', profile?.website],
    ['address', profile?.address || profile?.addressLine1],
    ['logo', profile?.logoUrl || profile?.logoDocumentId],
    ['license', profile?.licenseNumber],
    ['payment instructions', profile?.paymentInstructions],
    ['warranty text', profile?.warrantyText],
    ['legal footer', profile?.legalFooter],
  ] as const
  const missing = checks.filter(([, value]) => !value).map(([label]) => label)
  const score = Math.round(((checks.length - missing.length) / checks.length) * 100)
  return { score, missing }
}

export async function getCompanyKpis(contractorId: string, periodDays = 7): Promise<CompanyKpiSnapshot> {
  const days = Math.max(1, Math.min(90, Math.round(periodDays || 7)))
  const now = new Date()
  const currentStart = startOfDay(addDays(now, -days))
  const previousStart = startOfDay(addDays(now, -days * 2))
  const monthStart = startOfMonth(now)
  const upcomingEnd = addDays(now, 14)

  const [
    totalLeads,
    leadsThisPeriod,
    leadsPreviousPeriod,
    newLeads,
    inspectionLeads,
    convertedLeads,
    totalCustomers,
    customersThisPeriod,
    totalProjects,
    activeProjects,
    projectsThisPeriod,
    appointmentsUpcoming,
    inspectionsUpcoming,
    documentsThisPeriod,
    photosThisPeriod,
    estimates,
    priceSheetDocs,
    pendingPriceSheetDocs,
    priceSheetRows,
    pendingActions,
    activeInsights,
    failedOrReviewDocs,
    aiCallsThisMonth,
    webSearchThisMonth,
    aiCost,
  ] = await Promise.all([
    db.canvassingLead.count({ where: { contractorId } }).catch(() => 0),
    db.canvassingLead.count({ where: { contractorId, createdAt: { gte: currentStart } } }).catch(() => 0),
    db.canvassingLead.count({ where: { contractorId, createdAt: { gte: previousStart, lt: currentStart } } }).catch(() => 0),
    db.canvassingLead.count({ where: { contractorId, status: 'new' } }).catch(() => 0),
    db.canvassingLead.count({ where: { contractorId, status: { in: ['inspection_set', 'interested', 'follow_up'] } } }).catch(() => 0),
    db.canvassingLead.count({ where: { contractorId, status: 'converted' } }).catch(() => 0),
    db.customer.count({ where: { contractorId } }).catch(() => 0),
    db.customer.count({ where: { contractorId, createdAt: { gte: currentStart } } }).catch(() => 0),
    db.project.count({ where: { contractorId } }).catch(() => 0),
    db.project.count({ where: { contractorId, status: { notIn: ['closed', 'cancelled', 'deleted'] } } }).catch(() => 0),
    db.project.count({ where: { contractorId, createdAt: { gte: currentStart } } }).catch(() => 0),
    db.appointment.count({ where: { contractorId, status: 'scheduled', startTime: { gte: now, lte: upcomingEnd } } }).catch(() => 0),
    db.appointment.count({ where: { contractorId, type: 'inspection', status: 'scheduled', startTime: { gte: now, lte: upcomingEnd } } }).catch(() => 0),
    db.document.count({ where: { contractorId, createdAt: { gte: currentStart } } }).catch(() => 0),
    db.document.count({ where: { contractorId, fileType: 'photo', createdAt: { gte: currentStart } } }).catch(() => 0),
    db.document.count({ where: { contractorId, fileType: { in: ['estimate', 'scope_of_loss', 'insurance_claim'] } } }).catch(() => 0),
    db.document.count({ where: { contractorId, fileType: 'price_sheet' } }).catch(() => 0),
    db.document.count({ where: { contractorId, fileType: 'price_sheet', status: { in: ['pending_review', 'needs_review', 'needs_ocr', 'processing'] } } }).catch(() => 0),
    db.priceSheet.count({ where: { contractorId } }).catch(() => 0),
    db.actionRequest.count({ where: { contractorId, status: { in: ['pending', 'needs_approval', 'routed'] } } }).catch(() => 0),
    db.insight.count({ where: { contractorId, status: { in: ['active', 'needs_attention', 'needs_approval', 'waiting_customer', 'waiting_carrier', 'waiting_internal'] } } }).catch(() => 0),
    db.document.count({ where: { contractorId, status: { in: ['failed', 'needs_review', 'needs_ocr', 'pending_review'] } } }).catch(() => 0),
    db.aIUsageLog.count({ where: { contractorId, createdAt: { gte: monthStart } } }).catch(() => 0),
    db.aIUsageLog.count({ where: { contractorId, purpose: 'web_search', createdAt: { gte: monthStart } } }).catch(() => 0),
    db.aIUsageLog.aggregate({ where: { contractorId, createdAt: { gte: monthStart } }, _sum: { estimatedCost: true } }).catch(() => ({ _sum: { estimatedCost: null } })),
  ])

  return {
    periodDays: days,
    generatedAt: now.toISOString(),
    leads: {
      total: totalLeads,
      thisPeriod: leadsThisPeriod,
      previousPeriod: leadsPreviousPeriod,
      new: newLeads,
      inspectionSet: inspectionLeads,
      converted: convertedLeads,
    },
    customers: {
      total: totalCustomers,
      addedThisPeriod: customersThisPeriod,
    },
    projects: {
      total: totalProjects,
      active: activeProjects,
      addedThisPeriod: projectsThisPeriod,
    },
    appointments: {
      upcoming14Days: appointmentsUpcoming,
      inspectionsUpcoming14Days: inspectionsUpcoming,
    },
    files: {
      documentsThisPeriod,
      photosThisPeriod,
      estimates,
      priceSheets: Math.max(priceSheetDocs, priceSheetRows),
      priceSheetsPendingReview: pendingPriceSheetDocs,
    },
    operations: {
      pendingActions,
      activeInsights,
      failedOrReviewItems: failedOrReviewDocs,
    },
    usage: {
      aiCallsThisMonth,
      webSearchCallsThisMonth: webSearchThisMonth,
      estimatedCostThisMonth: aiCost._sum.estimatedCost ?? null,
    },
  }
}

function buildRecommendations(input: {
  profileReady: ReturnType<typeof profileReadiness>
  kpis: CompanyKpiSnapshot
  research?: CompanyResearch | null
  researched: boolean
}) {
  const out: CompanyIntelligenceSnapshot['recommendations'] = []
  if (input.profileReady.missing.length) {
    out.push({
      title: 'Finish company profile setup',
      detail: `Missing: ${input.profileReady.missing.slice(0, 5).join(', ')}. These affect estimates, invoices, reports, contracts, and signatures.`,
      prompt: 'Show my company profile setup gaps and give me chat prompts to fill each one.',
      priority: 'high',
    })
  }
  if (input.kpis.leads.thisPeriod === 0) {
    out.push({
      title: 'Create lead flow this week',
      detail: 'No new leads are saved for this period yet. Use field mode, referrals, website follow-up, or past-customer outreach.',
      prompt: 'Help me create a lead generation plan for this week using my current company profile and saved Jobrolo data.',
      priority: 'normal',
    })
  }
  if (input.kpis.operations.pendingActions > 0 || input.kpis.operations.failedOrReviewItems > 0) {
    out.push({
      title: 'Clear action-needed items',
      detail: `${input.kpis.operations.pendingActions} pending/routed actions and ${input.kpis.operations.failedOrReviewItems} files needing review are slowing down trust in the system.`,
      prompt: 'Show what needs attention right now and group it by approvals, review items, failed work, and routed tasks.',
      priority: 'high',
    })
  }
  if (!input.researched || !input.research?.webPresence?.enabled) {
    out.push({
      title: 'Run public web/social research',
      detail: 'I can compare your saved profile against public website, BBB, review, directory, blog, and social signals.',
      prompt: 'Research my company online and social media. Show public evidence, source previews, setup gaps, and growth recommendations.',
      priority: 'normal',
    })
  } else if (!input.research.webPresence.googleReviews?.found) {
    out.push({
      title: 'Review reputation visibility',
      detail: 'Public research did not confidently find Google review details. Confirm your Google Business Profile or connect analytics later.',
      prompt: 'Help me find or set up my Google Business Profile review presence for my roofing company.',
      priority: 'low',
    })
  }
  if (input.kpis.files.priceSheetsPendingReview > 0) {
    out.push({
      title: 'Review company price sheets',
      detail: `${input.kpis.files.priceSheetsPendingReview} price sheet file(s) may need review before importing material pricing.`,
      prompt: 'Show my company price sheets pending review and let me review extracted rows before importing.',
      priority: 'normal',
    })
  }
  return out.slice(0, 5)
}

function profileSuggestionFromResearch(research: CompanyResearch | null, existingProfile: any) {
  if (!research) return undefined
  const name = existingProfile?.companyName || existingProfile?.displayName || research.companyName
  return {
    companyName: name || research.companyName || undefined,
    displayName: name || research.companyName || undefined,
    phone: research.phone || undefined,
    email: research.email || undefined,
    logoUrl: research.logoUrl || undefined,
    website: research.website || existingProfile?.website || undefined,
    metadata: {
      websiteResearch: {
        description: research.description ?? null,
        services: research.services,
        serviceAreas: research.serviceAreas,
        location: research.location ?? null,
        businessType: research.businessType ?? null,
        teamSizeEstimate: research.teamSizeEstimate ?? null,
        socialProfiles: research.socialProfiles,
        confidence: research.confidence,
        source: research.source,
        webPresence: research.webPresence ?? null,
        researchedAt: new Date().toISOString(),
      },
    },
  }
}

function publicPresenceFromResearch(research: CompanyResearch | null, metadataResearch?: any): CompanyIntelligenceSnapshot['publicPresence'] {
  const sourceResearch = research ?? metadataResearch
  const webPresence = research?.webPresence ?? metadataResearch?.webPresence
  const freshSources = publicSources(research)
  if (!sourceResearch && !webPresence) {
    return {
      researched: false,
      sources: [],
      error: isOpenAIWebSearchConfigured()
        ? 'No public company research has been run yet.'
        : 'OpenAI web search is not configured for public company research.',
    }
  }

  return {
    researched: Boolean(research || webPresence),
    provider: webPresence?.provider,
    summary: webPresence?.summary || sourceResearch?.description,
    companyName: sourceResearch?.companyName,
    website: sourceResearch?.website,
    logoUrl: sourceResearch?.logoUrl || webPresence?.logoUrl,
    phone: sourceResearch?.phone || webPresence?.phone,
    email: sourceResearch?.email || webPresence?.email,
    googleReviews: webPresence?.googleReviews,
    reviews: webPresence?.reviews ?? [],
    bbb: webPresence?.bbb,
    socialProfiles: sourceResearch?.socialProfiles ?? {},
    socialSignals: webPresence?.socialSignals ?? [],
    contentSignals: webPresence?.contentSignals ?? [],
    directoryListings: webPresence?.directoryListings ?? [],
    mentions: webPresence?.mentions ?? [],
    warnings: webPresence?.warnings ?? [],
    sources: freshSources.length ? freshSources : (webPresence?.sources ?? []),
    error: webPresence?.error,
  }
}

function usageNote(mode?: CompanyResearchMode, researched?: boolean) {
  if (!researched) return undefined
  if (mode === 'deep') return 'Deep public web/social research used a higher search context and should count as heavier usage.'
  if (mode === 'cheap') return 'Cheap public research used a smaller search context to control cost.'
  return 'Normal public web/social research was usage-logged as web_search.'
}

export async function getCompanyIntelligence(input: {
  contractorId: string
  periodDays?: number
  includePublicResearch?: boolean
  searchMode?: CompanyResearchMode
  website?: string
  companyName?: string
}) {
  const profileRow = await getOrCreateContractorProfile(input.contractorId)
  const profile = publicContractorProfile(profileRow)
  const metadata = safeParseJson<any>(profileRow?.metadataJson)
  const existingResearch = metadata?.websiteResearch ?? null
  const searchMode = input.searchMode ?? 'normal'
  const shouldResearch = Boolean(input.includePublicResearch)
  const research = shouldResearch
      ? await researchCompany({
        website: input.website || profileRow?.website || undefined,
        companyName: input.companyName || profileRow?.companyName || profileRow?.displayName || undefined,
        preferredCompanyName: input.companyName || profileRow?.companyName || profileRow?.displayName || undefined,
        includeWebPresence: true,
        searchMode,
      }).catch(() => null)
    : null
  const kpis = await getCompanyKpis(input.contractorId, input.periodDays ?? 7)
  const ready = profileReadiness(profile)
  const researched = Boolean(research)
  const snapshot: CompanyIntelligenceSnapshot = {
    cardType: 'company_intelligence',
    status: researched ? 'researched' : ready.missing.length ? 'needs_setup' : 'snapshot',
    generatedAt: new Date().toISOString(),
    searchMode,
    usageNote: usageNote(searchMode, researched),
    analyticsNote: 'Public web/social search can summarize visible signals. Traffic, attribution, ad performance, and exact private social analytics require future integrations like Google Analytics, Google Business Profile, Meta, or TikTok.',
    profile,
    profileReadiness: ready,
    kpis,
    publicPresence: publicPresenceFromResearch(research, existingResearch),
    recommendations: buildRecommendations({ profileReady: ready, kpis, research, researched: researched || Boolean(existingResearch) }),
    profileSuggestions: profileSuggestionFromResearch(research, profileRow),
  }
  return snapshot
}
