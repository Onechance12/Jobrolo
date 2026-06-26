import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/security/context'
import { normalizePropertyAddress, upsertPropertyMemory, getPropertyMemoryContext, createCanvassingGamePlan } from '@/lib/property-memory'
import { isOpenAIWebSearchConfigured, openAIWebSearch, type WebSearchSource } from '@/lib/openai-web-search'

type LocationInput = {
  lat?: number | null
  lng?: number | null
  latitude?: number | null
  longitude?: number | null
  accuracyMeters?: number | null
  source?: string | null
}

export type PropertyResearchInput = {
  mode?: 'approaching_house' | 'address_lookup' | 'street_game_plan' | 'neighborhood_research' | string | null
  query?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  streets?: string[] | null
  location?: LocationInput | null
  focusMode?: string | null
  energyLevel?: string | null
  mindset?: string | null
  timeBudgetMinutes?: number | null
  goalDoors?: number | null
  goalConversations?: number | null
  goalInspections?: number | null
  notes?: string | null
  allowProviderLookup?: boolean | null
  saveCandidates?: boolean | null
}

export type ConfirmResearchInput = {
  candidateId?: string | null
  createMemory?: boolean | null
  status?: string | null
  notes?: string | null
  confirmedOwnerName?: string | null
  confirmedAddress?: string | null
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function normalizeLocation(input?: LocationInput | null) {
  if (!input) return null
  const lat = typeof input.lat === 'number' ? input.lat : input.latitude
  const lng = typeof input.lng === 'number' ? input.lng : input.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng, accuracyMeters: input.accuracyMeters ?? null, source: input.source ?? null }
}

function extractStreetName(value?: string | null) {
  const base = (value || '').trim()
  if (!base) return null
  return base
    .replace(/^\d+\s+/, '')
    .replace(/\b(street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|place|pl\.?)\b.*$/i, '')
    .trim() || base
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = (value || '').trim()
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function extractJsonObject(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] || text || '').trim()
  const start = body.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < body.length; i++) {
    const ch = body[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

function scoreCandidate(input: {
  source?: string | null
  propertyMemory?: any
  candidate?: any
  focusMode?: string | null
}) {
  const memory = input.propertyMemory
  const c = input.candidate ?? {}
  let roofOpportunityScore = 0
  let followUpScore = 0
  let stormExposureScore = Number(c.stormExposureScore ?? 0)

  const roof = String(memory?.roofCondition ?? c.roofCondition ?? '').toLowerCase()
  const damage = String(memory?.damageSignal ?? c.damageSignal ?? '').toLowerCase()
  const status = String(memory?.status ?? c.status ?? '').toLowerCase()
  const solicitation = String(memory?.solicitationStatus ?? c.solicitationStatus ?? '').toLowerCase()
  const ownerOccupied = String(c.ownerOccupiedSignal ?? memory?.ownerOccupiedSignal ?? memory?.occupancyStatus ?? '').toLowerCase()
  const value = Number(c.marketValue ?? memory?.marketValue ?? 0)
  const sqft = Number(c.livingAreaSqft ?? memory?.livingAreaSqft ?? 0)
  const yearBuilt = Number(c.yearBuilt ?? memory?.yearBuilt ?? 0)

  if (['damaged', 'missing_shingles', 'tarped', 'aged'].some(v => roof.includes(v))) roofOpportunityScore += 28
  if (damage.includes('hail') || damage.includes('wind') || damage.includes('missing') || damage.includes('ridge')) roofOpportunityScore += 24
  if (yearBuilt && yearBuilt < new Date().getFullYear() - 12) roofOpportunityScore += 10
  if (sqft >= 2200) roofOpportunityScore += 8
  if (value >= 350000) roofOpportunityScore += 8
  if (ownerOccupied.includes('owner')) roofOpportunityScore += 6
  if (ownerOccupied.includes('rental') || ownerOccupied.includes('renter')) roofOpportunityScore -= 8
  if (status === 'follow_up' || memory?.nextFollowUpAt) followUpScore += 35
  if (status === 'prospect') followUpScore += 22
  if (status === 'converted' || status === 'not_fit') followUpScore -= 20
  if (['do_not_knock', 'no_soliciting'].includes(solicitation)) roofOpportunityScore -= 80

  const focus = input.focusMode || ''
  if (focus === 'follow_ups') followUpScore += 18
  if (focus === 'higher_value' && (value >= 350000 || sqft >= 2200)) roofOpportunityScore += 14
  if (focus === 'old_damage' && (roof.includes('aged') || yearBuilt < new Date().getFullYear() - 15)) roofOpportunityScore += 14
  if (focus === 'fresh_hail') stormExposureScore += 10

  roofOpportunityScore = Math.max(0, Math.min(100, Math.round(roofOpportunityScore)))
  followUpScore = Math.max(0, Math.min(100, Math.round(followUpScore)))
  stormExposureScore = Math.max(0, Math.min(100, Math.round(stormExposureScore)))
  const overallScore = Math.max(0, Math.min(100, Math.round((roofOpportunityScore * 0.45) + (followUpScore * 0.30) + (stormExposureScore * 0.25))))
  return { roofOpportunityScore, followUpScore, stormExposureScore, overallScore }
}

async function callExternalPropertyProvider(ctx: TenantContext, input: PropertyResearchInput) {
  const enabled = process.env.PROPERTY_RESEARCH_ENABLED === '1'
  const url = process.env.PROPERTY_RESEARCH_WEBHOOK_URL || process.env.PROPERTY_DATA_WEBHOOK_URL
  if (!enabled || !url) return { candidates: [], provider: 'disabled', summary: 'External property lookup is not configured.' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.PROPERTY_RESEARCH_API_KEY ? { Authorization: `Bearer ${process.env.PROPERTY_RESEARCH_API_KEY}` } : {}),
      },
      body: JSON.stringify({ contractorId: ctx.contractorId, query: input.query, address: input.address, city: input.city, state: input.state, postalCode: input.postalCode, streets: input.streets, location: input.location, mode: input.mode }),
      signal: controller.signal,
    })
    if (!res.ok) return { candidates: [], provider: 'provider_error', summary: `Property provider returned ${res.status}.` }
    const json = await res.json().catch(() => ({}))
    const candidates = Array.isArray(json?.candidates) ? json.candidates : Array.isArray(json?.properties) ? json.properties : []
    return { candidates, provider: 'webhook', summary: json?.summary || `Provider returned ${candidates.length} candidate(s).` }
  } catch (error) {
    return { candidates: [], provider: 'provider_failed', summary: error instanceof Error ? error.message : 'Property provider lookup failed.' }
  } finally {
    clearTimeout(timeout)
  }
}

const BLOCKED_PROPERTY_SEARCH_DOMAINS = [
  'whitepages.com',
  'spokeo.com',
  'beenverified.com',
  'truthfinder.com',
  'fastpeoplesearch.com',
  'radaris.com',
  'mylife.com',
  'peoplefinders.com',
]

function sourceLine(sources: WebSearchSource[]) {
  return sources
    .map(source => source.url)
    .filter(Boolean)
    .slice(0, 4)
    .join(' | ')
}

function buildPropertyWebSearchPrompt(input: PropertyResearchInput) {
  const loc = normalizeLocation(input.location)
  const parts = [
    input.address ? `Address: ${input.address}` : null,
    input.city ? `City: ${input.city}` : null,
    input.state ? `State: ${input.state}` : null,
    input.postalCode ? `ZIP: ${input.postalCode}` : null,
    loc ? `GPS: ${loc.lat}, ${loc.lng} accuracy ${loc.accuracyMeters ?? 'unknown'}m` : null,
    input.query ? `User query/context: ${input.query}` : null,
    input.notes ? `Field notes: ${input.notes}` : null,
  ].filter(Boolean).join('\n')

  return `You are helping a roofing contractor verify public property information while standing in the field.

Use web search to find likely public property/appraisal/tax records for this property.
Prioritize official county appraisal district, county property tax, county assessor, city parcel, or official GIS/property records.
Examples of relevant North Texas appraisal sources include tad.org, dentoncad.org, prad.org, collincad.org, dallascad.org, but choose the correct public source for the location.
Avoid people-search/private-broker sites. Do not guess owner identity from unofficial people profiles.

Input:
${parts || 'No address supplied. Search from the GPS/current-location context if possible.'}

Return ONLY valid JSON:
{
  "summary": "short human summary",
  "warnings": ["anything uncertain, missing, or not found"],
  "candidates": [
    {
      "address": "situs/property address",
      "city": "city if found",
      "state": "state if found",
      "postalCode": "zip if found",
      "ownerName": "owner name from official public record if found",
      "ownerMailingAddress": "mailing address if found",
      "parcelId": "parcel id if found",
      "countyAccountId": "account/property id if found",
      "county": "county/appraisal district if found",
      "source": "official source name",
      "sourceUrl": "best source URL",
      "confidence": 0.0,
      "matchReason": "why this candidate matches the field location or address",
      "propertyType": "property type if found",
      "marketValue": "number if found",
      "assessedValue": "number if found",
      "improvementValue": "number if found",
      "landValue": "number if found",
      "livingAreaSqft": "number if found",
      "yearBuilt": "number if found",
      "ownerOccupiedSignal": "owner_occupied|rental|unknown if supportable"
    }
  ]
}

Rules:
- If you only have GPS and cannot verify the exact address from an official source, return a candidate with confidence <= 0.55 and explain that confirmation is required.
- If address/owner data comes from an official appraisal/tax source, confidence may be higher.
- Do not include claim, insurance, or sales assumptions.
- Do not invent missing values.`
}

async function callOpenAIPropertyWebSearch(ctx: TenantContext, input: PropertyResearchInput) {
  if (input.allowProviderLookup === false) return { candidates: [], provider: 'openai_web_search_skipped', summary: 'OpenAI web search skipped.' }
  if (!isOpenAIWebSearchConfigured()) return { candidates: [], provider: 'openai_web_search_disabled', summary: 'OpenAI web search is not configured.' }

  const mode = input.mode || (input.streets?.length ? 'street_game_plan' : input.address ? 'address_lookup' : 'approaching_house')
  if (mode === 'street_game_plan' && input.allowProviderLookup !== true) {
    return { candidates: [], provider: 'openai_web_search_skipped', summary: 'OpenAI web search skipped for broad street research to control cost. Ask to research the street online to run it.' }
  }

  const result = await openAIWebSearch(buildPropertyWebSearchPrompt(input), {
    contractorId: ctx.contractorId,
    userId: ctx.user?.id,
    searchContextSize: mode === 'street_game_plan' ? 'high' : 'medium',
    timeoutMs: mode === 'street_game_plan' ? 45_000 : 30_000,
    maxOutputTokens: mode === 'street_game_plan' ? 2600 : 1800,
    forceSearch: true,
    blockedDomains: BLOCKED_PROPERTY_SEARCH_DOMAINS,
    userLocation: (input.city || input.state) ? {
      country: 'US',
      ...(input.city ? { city: input.city } : {}),
      ...(input.state ? { region: input.state } : {}),
    } : undefined,
  })

  if (!result.ok) return { candidates: [], provider: 'openai_web_search_failed', summary: result.error || 'OpenAI web search failed.', sources: [] as WebSearchSource[] }

  const parsed = extractJsonObject(result.text) || {}
  const parsedCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : []
  const fallbackSources = sourceLine(result.sources)
  const candidates = parsedCandidates.map((raw: any) => {
    const bestUrl = raw.sourceUrl || raw.url || result.sources[0]?.url
    const data = providerCandidateToData({
      ...raw,
      source: 'openai_web_search',
      matchReason: [raw.matchReason || raw.reason, bestUrl ? `Source: ${bestUrl}` : fallbackSources ? `Sources: ${fallbackSources}` : null].filter(Boolean).join(' '),
      rawJson: JSON.stringify({ ...raw, webSearchSources: result.sources, model: result.model, warnings: parsed?.warnings || [] }),
    }, input)
    return {
      ...data,
      source: 'openai_web_search',
      confidence: Math.max(0, Math.min(0.95, Number(raw.confidence ?? data.confidence ?? 0.62))),
      rawJson: JSON.stringify({ ...raw, webSearchSources: result.sources, model: result.model, warnings: parsed?.warnings || [] }),
    }
  })

  return {
    candidates,
    provider: 'openai_web_search',
    summary: parsed?.summary || (candidates.length ? `OpenAI web search found ${candidates.length} public property candidate(s).` : `OpenAI web search ran but did not return structured property candidates. ${result.text.slice(0, 300)}`),
    sources: result.sources,
    model: result.model,
    warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : [],
  }
}

async function callPropertyProviders(ctx: TenantContext, input: PropertyResearchInput) {
  if (input.allowProviderLookup === false) return { candidates: [], provider: 'skipped', summary: 'Provider lookup skipped.' }
  const [webhook, openaiWeb] = await Promise.all([
    callExternalPropertyProvider(ctx, input),
    callOpenAIPropertyWebSearch(ctx, input),
  ])
  const candidates = [...(webhook.candidates || []), ...(openaiWeb.candidates || [])]
  const summaries = [webhook.summary, openaiWeb.summary].filter(Boolean)
  return {
    candidates,
    provider: [webhook.provider, openaiWeb.provider].filter(Boolean).join('+') || 'none',
    summary: summaries.join(' '),
    webhook,
    openaiWebSearch: openaiWeb,
  }
}

async function findCachedPropertyCandidates(ctx: TenantContext, input: PropertyResearchInput) {
  const normalized = normalizePropertyAddress(input.address)
  const streets = uniqueStrings([...(input.streets || []), extractStreetName(input.address)])
  const where: any = { contractorId: ctx.contractorId }

  if (normalized) {
    where.normalizedAddress = normalized
  } else if (streets.length) {
    where.OR = streets.map(street => ({ address: { contains: street } }))
  } else {
    where.status = { in: ['follow_up', 'prospect', 'watch'] }
  }

  return db.propertyMemory.findMany({ where, orderBy: [{ opportunityScore: 'desc' as any }, { updatedAt: 'desc' }], take: input.mode === 'street_game_plan' ? 200 : 25 })
}

function providerCandidateToData(raw: any, fallback: PropertyResearchInput) {
  const address = raw.address || raw.situsAddress || raw.propertyAddress || fallback.address
  const ownerName = raw.ownerName || raw.owner || raw.name || raw.owner_full_name
  const ownerMailingAddress = raw.ownerMailingAddress || raw.mailingAddress || raw.ownerAddress
  const lat = typeof raw.latitude === 'number' ? raw.latitude : typeof raw.lat === 'number' ? raw.lat : null
  const lng = typeof raw.longitude === 'number' ? raw.longitude : typeof raw.lng === 'number' ? raw.lng : null
  return {
    address,
    normalizedAddress: normalizePropertyAddress(address),
    city: raw.city || fallback.city,
    state: raw.state || fallback.state,
    postalCode: raw.postalCode || raw.zip || raw.zipCode || fallback.postalCode,
    ownerName,
    ownerMailingAddress,
    parcelId: raw.parcelId || raw.parcel || raw.account || raw.accountId,
    countyAccountId: raw.countyAccountId || raw.accountId || raw.account,
    source: raw.source || 'provider',
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.68,
    matchReason: raw.matchReason || raw.reason || 'Matched from configured property data provider.',
    latitude: lat ?? undefined,
    longitude: lng ?? undefined,
    propertyType: raw.propertyType || raw.type,
    marketValue: numberOrUndefined(raw.marketValue ?? raw.value ?? raw.totalValue),
    assessedValue: numberOrUndefined(raw.assessedValue),
    improvementValue: numberOrUndefined(raw.improvementValue),
    landValue: numberOrUndefined(raw.landValue),
    livingAreaSqft: intOrUndefined(raw.livingAreaSqft ?? raw.sqft ?? raw.squareFeet),
    yearBuilt: intOrUndefined(raw.yearBuilt),
    bedrooms: numberOrUndefined(raw.bedrooms ?? raw.beds),
    bathrooms: numberOrUndefined(raw.bathrooms ?? raw.baths),
    stories: numberOrUndefined(raw.stories),
    ownerOccupiedSignal: raw.ownerOccupiedSignal || raw.ownerOccupied || raw.occupancy,
    rawJson: JSON.stringify(raw),
  }
}

function numberOrUndefined(value: unknown) {
  if (value == null || value === '') return undefined
  const n = Number(String(value).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : undefined
}
function intOrUndefined(value: unknown) {
  const n = numberOrUndefined(value)
  return typeof n === 'number' ? Math.round(n) : undefined
}

function memoryToCandidate(memory: any, focusMode?: string | null) {
  const score = scoreCandidate({ propertyMemory: memory, focusMode })
  return {
    propertyMemoryId: memory.id,
    address: memory.address,
    normalizedAddress: memory.normalizedAddress,
    city: memory.city,
    state: memory.state,
    postalCode: memory.postalCode,
    ownerName: memory.ownerName || safeJson<Record<string, any>>(memory.dataSourceJson, {}).homeownerName,
    ownerMailingAddress: memory.ownerMailingAddress,
    parcelId: memory.parcelId,
    countyAccountId: memory.countyAccountId,
    source: memory.lastEnrichedAt ? 'cached_enrichment' : 'property_memory',
    confidence: 0.78,
    matchReason: 'Matched existing Jobrolo property memory.',
    latitude: memory.latitude,
    longitude: memory.longitude,
    propertyType: memory.propertyType,
    marketValue: memory.marketValue,
    assessedValue: memory.assessedValue,
    improvementValue: memory.improvementValue,
    landValue: memory.landValue,
    livingAreaSqft: memory.livingAreaSqft,
    yearBuilt: memory.yearBuilt,
    bedrooms: memory.bedrooms,
    bathrooms: memory.bathrooms,
    stories: memory.stories,
    ownerOccupiedSignal: memory.ownerOccupiedSignal || memory.occupancyStatus,
    ...score,
    rawJson: JSON.stringify({ propertyMemoryId: memory.id, roofCondition: memory.roofCondition, damageSignal: memory.damageSignal, status: memory.status, summary: memory.summary }),
  }
}

function inferredCandidate(input: PropertyResearchInput) {
  if (!input.address && !input.location) return null
  const loc = normalizeLocation(input.location)
  const address = input.address || input.query || 'Current GPS property'
  return {
    address,
    normalizedAddress: normalizePropertyAddress(address),
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    source: loc ? 'gps_unverified' : 'manual_unverified',
    confidence: loc ? 0.42 : 0.35,
    matchReason: loc ? 'Created from current GPS/address context. Needs confirmation before saving.' : 'Created from the user-provided address. Needs enrichment/confirmation.',
    latitude: loc?.lat,
    longitude: loc?.lng,
    roofOpportunityScore: 0,
    followUpScore: 0,
    stormExposureScore: 0,
    overallScore: 0,
    rawJson: JSON.stringify({ inferred: true, input }),
  }
}

export async function researchPropertyNow(ctx: TenantContext, input: PropertyResearchInput) {
  const loc = normalizeLocation(input.location)
  const streets = uniqueStrings(input.streets || [])
  const normalizedAddress = normalizePropertyAddress(input.address)
  const mode = input.mode || (streets.length ? 'street_game_plan' : input.address ? 'address_lookup' : 'approaching_house')

  const run = await db.propertyResearchRun.create({
    data: {
      contractorId: ctx.contractorId,
      userId: ctx.user?.id,
      mode,
      status: 'researching',
      query: input.query ?? undefined,
      requestedAddress: input.address ?? undefined,
      normalizedAddress: normalizedAddress || undefined,
      streetNamesJson: streets.length ? JSON.stringify(streets) : undefined,
      city: input.city ?? undefined,
      state: input.state ?? undefined,
      postalCode: input.postalCode ?? undefined,
      latitude: loc?.lat,
      longitude: loc?.lng,
      accuracyMeters: loc?.accuracyMeters ?? undefined,
      focusMode: input.focusMode ?? undefined,
      energyLevel: input.energyLevel ?? undefined,
      mindset: input.mindset ?? input.notes ?? undefined,
      timeBudgetMinutes: input.timeBudgetMinutes ?? undefined,
      goalDoors: input.goalDoors ?? undefined,
      goalConversations: input.goalConversations ?? undefined,
      goalInspections: input.goalInspections ?? undefined,
      metadataJson: JSON.stringify({ notes: input.notes, locationSource: loc?.source, allowProviderLookup: input.allowProviderLookup !== false }),
    },
  })

  try {
    const memories = await findCachedPropertyCandidates(ctx, input)
    const provider = input.allowProviderLookup === false ? { candidates: [], provider: 'skipped', summary: 'Provider lookup skipped.' } : await callPropertyProviders(ctx, input)
    const rawCandidates = [
      ...memories.map(m => memoryToCandidate(m, input.focusMode)),
      ...(provider.candidates || []).map(raw => {
        const data = providerCandidateToData(raw, input)
        return { ...data, ...scoreCandidate({ candidate: data, focusMode: input.focusMode }) }
      }),
      inferredCandidate(input),
    ].filter(Boolean) as any[]

    const deduped = dedupeCandidates(rawCandidates).slice(0, mode === 'street_game_plan' ? 250 : 12)
    const created: Awaited<ReturnType<typeof db.propertyResearchCandidate.create>>[] = []
    for (const c of deduped) {
      const candidate = await db.propertyResearchCandidate.create({
        data: {
          contractorId: ctx.contractorId,
          researchRunId: run.id,
          propertyMemoryId: c.propertyMemoryId ?? undefined,
          address: c.address ?? undefined,
          normalizedAddress: c.normalizedAddress || normalizePropertyAddress(c.address),
          city: c.city ?? undefined,
          state: c.state ?? undefined,
          postalCode: c.postalCode ?? undefined,
          ownerName: c.ownerName ?? undefined,
          ownerMailingAddress: c.ownerMailingAddress ?? undefined,
          parcelId: c.parcelId ?? undefined,
          countyAccountId: c.countyAccountId ?? undefined,
          source: c.source ?? 'jobrolo',
          confidence: typeof c.confidence === 'number' ? c.confidence : 0,
          matchReason: c.matchReason ?? undefined,
          latitude: c.latitude ?? undefined,
          longitude: c.longitude ?? undefined,
          propertyType: c.propertyType ?? undefined,
          marketValue: c.marketValue ?? undefined,
          assessedValue: c.assessedValue ?? undefined,
          improvementValue: c.improvementValue ?? undefined,
          landValue: c.landValue ?? undefined,
          livingAreaSqft: c.livingAreaSqft ?? undefined,
          yearBuilt: c.yearBuilt ?? undefined,
          bedrooms: c.bedrooms ?? undefined,
          bathrooms: c.bathrooms ?? undefined,
          stories: c.stories ?? undefined,
          ownerOccupiedSignal: c.ownerOccupiedSignal ? String(c.ownerOccupiedSignal) : undefined,
          roofOpportunityScore: c.roofOpportunityScore ?? 0,
          stormExposureScore: c.stormExposureScore ?? 0,
          followUpScore: c.followUpScore ?? 0,
          overallScore: c.overallScore ?? 0,
          rawJson: c.rawJson ?? undefined,
        },
      })
      created.push(candidate)
      if (candidate.source !== 'gps_unverified' && candidate.source !== 'manual_unverified') {
        await createSnapshotFromCandidate(ctx, candidate, { researchRunId: run.id, raw: c }).catch(() => null)
      }
    }

    const best = created[0]
    const resultSummary = buildResearchSummary({ mode, candidates: created, providerSummary: provider.summary, streets })
    const confidence = best?.confidence ?? 0
    const status = created.length ? (confidence >= 0.75 ? 'needs_confirmation' : 'needs_confirmation') : 'failed'
    const updated = await db.propertyResearchRun.update({
      where: { id: run.id },
      data: {
        status,
        resultSummary,
        confidence,
        providerSummaryJson: JSON.stringify(provider),
      },
    })

    if (mode === 'street_game_plan') {
      const streetRun = await createStreetResearchRunFromCandidates(ctx, updated, created, input)
      return { run: updated, candidates: created, streetRun, summary: resultSummary, card: buildStreetResearchCard(updated, created, streetRun) }
    }

    return { run: updated, candidates: created, summary: resultSummary, card: buildPropertyResearchCard(updated, created) }
  } catch (error) {
    const updated = await db.propertyResearchRun.update({ where: { id: run.id }, data: { status: 'failed', error: error instanceof Error ? error.message : 'Unknown research error' } })
    return { run: updated, candidates: [], summary: updated.error, card: buildPropertyResearchCard(updated, []) }
  }
}

function dedupeCandidates(candidates: any[]) {
  const seen = new Set<string>()
  const out: any[] = []
  for (const c of candidates) {
    const key = normalizePropertyAddress(c.address) || `${c.latitude || ''}:${c.longitude || ''}:${c.ownerName || ''}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out.sort((a, b) => (Number(b.overallScore || 0) - Number(a.overallScore || 0)) || (Number(b.confidence || 0) - Number(a.confidence || 0)))
}

function buildResearchSummary(input: { mode: string; candidates: any[]; providerSummary?: string | null; streets: string[] }) {
  if (!input.candidates.length) return input.mode === 'street_game_plan' ? 'No properties were found for this street research yet. Try adding a city/state, importing a list, or enabling a property provider.' : 'No confident property matches were found yet. Confirm the address or enable a property provider.'
  if (input.mode === 'street_game_plan') {
    const hot = input.candidates.filter(c => c.overallScore >= 55).length
    const follow = input.candidates.filter(c => c.followUpScore >= 30).length
    return `I found ${input.candidates.length} property candidate(s) for ${input.streets.join(', ') || 'this area'}. ${hot} look like stronger opportunities and ${follow} have follow-up signals.`
  }
  const best = input.candidates[0]
  return `I found ${input.candidates.length} possible match(es). Best match: ${best.address || 'current property'}${best.ownerName ? ` · possible owner ${best.ownerName}` : ''}. Confirm before saving this as property memory.`
}

async function createSnapshotFromCandidate(ctx: TenantContext, candidate: any, input: { researchRunId?: string; raw?: any; propertyMemoryId?: string }) {
  return db.propertyEnrichmentSnapshot.create({
    data: {
      contractorId: ctx.contractorId,
      researchRunId: input.researchRunId,
      candidateId: candidate.id,
      propertyMemoryId: input.propertyMemoryId ?? candidate.propertyMemoryId ?? undefined,
      source: candidate.source || 'jobrolo',
      sourceLabel: candidate.source || 'Jobrolo property research',
      address: candidate.address ?? undefined,
      normalizedAddress: candidate.normalizedAddress ?? undefined,
      ownerName: candidate.ownerName ?? undefined,
      ownerMailingAddress: candidate.ownerMailingAddress ?? undefined,
      parcelId: candidate.parcelId ?? undefined,
      countyAccountId: candidate.countyAccountId ?? undefined,
      propertyType: candidate.propertyType ?? undefined,
      marketValue: candidate.marketValue ?? undefined,
      assessedValue: candidate.assessedValue ?? undefined,
      improvementValue: candidate.improvementValue ?? undefined,
      landValue: candidate.landValue ?? undefined,
      livingAreaSqft: candidate.livingAreaSqft ?? undefined,
      yearBuilt: candidate.yearBuilt ?? undefined,
      bedrooms: candidate.bedrooms ?? undefined,
      bathrooms: candidate.bathrooms ?? undefined,
      stories: candidate.stories ?? undefined,
      ownerOccupiedSignal: candidate.ownerOccupiedSignal ?? undefined,
      confidence: candidate.confidence ?? 0,
      rawJson: JSON.stringify(input.raw ?? candidate),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90),
    },
  })
}

export async function getPropertyResearchRun(ctx: TenantContext, id: string) {
  const run = await db.propertyResearchRun.findFirst({ where: { id, contractorId: ctx.contractorId } })
  if (!run) return null
  const [candidates, snapshots, streetRuns] = await Promise.all([
    db.propertyResearchCandidate.findMany({ where: { contractorId: ctx.contractorId, researchRunId: id }, orderBy: [{ overallScore: 'desc' as any }, { confidence: 'desc' as any }] }),
    db.propertyEnrichmentSnapshot.findMany({ where: { contractorId: ctx.contractorId, researchRunId: id }, orderBy: { capturedAt: 'desc' }, take: 50 }),
    db.streetResearchRun.findMany({ where: { contractorId: ctx.contractorId, metadataJson: { contains: id } as any }, orderBy: { createdAt: 'desc' }, take: 3 }).catch(() => []),
  ])
  return { run, candidates, snapshots, streetRuns, card: run.mode === 'street_game_plan' ? buildStreetResearchCard(run, candidates, streetRuns[0]) : buildPropertyResearchCard(run, candidates) }
}

export async function confirmPropertyResearchCandidate(ctx: TenantContext, researchRunId: string, input: ConfirmResearchInput) {
  const run = await db.propertyResearchRun.findFirst({ where: { id: researchRunId, contractorId: ctx.contractorId } })
  if (!run) throw new Error('Property research run not found')
  const candidate = input.candidateId
    ? await db.propertyResearchCandidate.findFirst({ where: { id: input.candidateId, contractorId: ctx.contractorId, researchRunId } })
    : await db.propertyResearchCandidate.findFirst({ where: { contractorId: ctx.contractorId, researchRunId }, orderBy: [{ overallScore: 'desc' as any }, { confidence: 'desc' as any }] })
  if (!candidate) throw new Error('Research candidate not found')

  let memoryId = candidate.propertyMemoryId ?? undefined
  if (input.createMemory !== false) {
    const memory = await upsertPropertyMemory(ctx, {
      address: input.confirmedAddress || candidate.address,
      city: candidate.city,
      state: candidate.state,
      postalCode: candidate.postalCode,
      homeownerName: input.confirmedOwnerName || candidate.ownerName,
      propertyType: candidate.propertyType,
      occupancyStatus: candidate.ownerOccupiedSignal?.includes('rental') ? 'renter' : candidate.ownerOccupiedSignal?.includes('owner') ? 'owner_occupied' : undefined,
      opportunityScore: candidate.overallScore,
      priority: candidate.overallScore >= 70 ? 'hot' : candidate.overallScore >= 50 ? 'high' : 'normal',
      status: input.status || 'watch',
      summary: input.notes || candidate.matchReason || run.resultSummary,
      location: typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number' ? { lat: candidate.latitude, lng: candidate.longitude, source: 'property_research' } : undefined,
      dataSource: { source: 'property_research', researchRunId: run.id, candidateId: candidate.id, candidateSource: candidate.source },
    })
    memoryId = memory.id
    await db.propertyMemory.update({
      where: { id: memory.id },
      data: {
        ownerName: input.confirmedOwnerName || candidate.ownerName || undefined,
        ownerMailingAddress: candidate.ownerMailingAddress ?? undefined,
        parcelId: candidate.parcelId ?? undefined,
        countyAccountId: candidate.countyAccountId ?? undefined,
        marketValue: candidate.marketValue ?? undefined,
        assessedValue: candidate.assessedValue ?? undefined,
        improvementValue: candidate.improvementValue ?? undefined,
        landValue: candidate.landValue ?? undefined,
        livingAreaSqft: candidate.livingAreaSqft ?? undefined,
        yearBuilt: candidate.yearBuilt ?? undefined,
        bedrooms: candidate.bedrooms ?? undefined,
        bathrooms: candidate.bathrooms ?? undefined,
        stories: candidate.stories ?? undefined,
        ownerOccupiedSignal: candidate.ownerOccupiedSignal ?? undefined,
        lastEnrichedAt: new Date(),
        enrichmentStatus: candidate.source.includes('provider') ? 'provider' : candidate.source.includes('memory') ? 'cached' : 'needs_review',
      } as any,
    }).catch(() => null)
    await createSnapshotFromCandidate(ctx, candidate, { researchRunId: run.id, propertyMemoryId: memory.id }).catch(() => null)
  }

  const [updatedRun, updatedCandidate] = await Promise.all([
    db.propertyResearchRun.update({ where: { id: run.id }, data: { status: 'confirmed', selectedCandidateId: candidate.id, createdMemoryId: memoryId, resultSummary: input.notes || run.resultSummary } }),
    db.propertyResearchCandidate.update({ where: { id: candidate.id }, data: { status: memoryId ? 'saved' : 'selected', propertyMemoryId: memoryId } }),
  ])

  return { run: updatedRun, candidate: updatedCandidate, propertyMemoryId: memoryId, card: { cardType: 'property_research_result', runId: updatedRun.id, candidateId: updatedCandidate.id, propertyMemoryId: memoryId, address: updatedCandidate.address, ownerName: updatedCandidate.ownerName, status: updatedRun.status, summary: updatedRun.resultSummary } }
}

async function createStreetResearchRunFromCandidates(ctx: TenantContext, run: any, candidates: any[], input: PropertyResearchInput) {
  const streets = uniqueStrings(input.streets || safeJson<string[]>(run.streetNamesJson, []))
  const hot = candidates.filter(c => c.overallScore >= 55).slice(0, 12)
  const follow = candidates.filter(c => c.followUpScore >= 25).slice(0, 12)
  const avoids = candidates.filter(c => String(c.rawJson || '').includes('no_soliciting') || String(c.rawJson || '').includes('do_not_knock')).slice(0, 10)
  const warm = ['low', 'warmup'].includes(input.energyLevel || '')
  const goals = warm ? { doors: 12, conversations: 4, inspections: 1 } : { doors: 25, conversations: 8, inspections: 2 }
  const focus = input.focusMode || 'partner_choice'
  const summary = buildPartnerGamePlanSummary({ focus, energyLevel: input.energyLevel, mindset: input.mindset, hotCount: hot.length, followCount: follow.length, streetNames: streets })
  const recommendedStart = follow[0]?.address || hot[0]?.address || streets[0] || 'Start with the highest-confidence street and reassess after ten doors.'
  const avoidNotes = avoids.length ? `Respect ${avoids.length} no-soliciting/do-not-knock or low-fit property memory record(s).` : 'No do-not-knock conflicts found in the current research set.'
  const scriptSuggestion = scriptForFocus(focus)

  const streetRun = await db.streetResearchRun.create({
    data: {
      contractorId: ctx.contractorId,
      userId: ctx.user?.id,
      status: 'researched',
      title: `${streets.join(' + ') || 'Street'} game plan`,
      streetNamesJson: JSON.stringify(streets),
      city: input.city ?? run.city ?? undefined,
      state: input.state ?? run.state ?? undefined,
      postalCode: input.postalCode ?? run.postalCode ?? undefined,
      focusMode: focus,
      energyLevel: input.energyLevel ?? undefined,
      mindset: input.mindset ?? input.notes ?? undefined,
      timeBudgetMinutes: input.timeBudgetMinutes ?? undefined,
      goalDoors: input.goalDoors ?? goals.doors,
      goalConversations: input.goalConversations ?? goals.conversations,
      goalInspections: input.goalInspections ?? goals.inspections,
      summary,
      recommendedStart,
      avoidNotes,
      scriptSuggestion,
      candidateSummaryJson: JSON.stringify({ hot: hot.map(cardCandidate), followUps: follow.map(cardCandidate), avoids: avoids.map(cardCandidate), totalCandidates: candidates.length }),
      metadataJson: JSON.stringify({ propertyResearchRunId: run.id }),
    },
  })

  const gamePlan = await createCanvassingGamePlan(ctx, {
    title: streetRun.title,
    territoryName: streets.join(', '),
    focusMode: focus,
    energyLevel: input.energyLevel,
    customerFocus: input.mindset || input.notes,
    timeBudgetMinutes: input.timeBudgetMinutes,
    goalDoors: input.goalDoors ?? goals.doors,
    goalConversations: input.goalConversations ?? goals.conversations,
    goalInspections: input.goalInspections ?? goals.inspections,
    notes: summary,
  }).catch(() => null)

  if (gamePlan?.plan?.id) {
    return db.streetResearchRun.update({ where: { id: streetRun.id }, data: { createdGamePlanId: gamePlan.plan.id } })
  }
  return streetRun
}

function cardCandidate(c: any) {
  const raw = safeJson<Record<string, any>>(c.rawJson, {})
  const sources = Array.isArray(raw.webSearchSources) ? raw.webSearchSources : []
  return {
    id: c.id,
    propertyMemoryId: c.propertyMemoryId,
    address: c.address,
    ownerName: c.ownerName,
    score: c.overallScore,
    confidence: c.confidence,
    reason: c.matchReason,
    source: c.source,
    sourceUrl: raw.sourceUrl || raw.url || sources[0]?.url || null,
    sources: sources.slice(0, 5),
  }
}

function buildPartnerGamePlanSummary(input: { focus: string; energyLevel?: string | null; mindset?: string | null; hotCount: number; followCount: number; streetNames: string[] }) {
  const energy = input.energyLevel === 'low' || input.energyLevel === 'warmup'
    ? 'Let’s build momentum first instead of forcing a grind.'
    : input.energyLevel === 'high'
      ? 'You have room for a stronger push, but we’ll still keep it smart.'
      : 'We’ll keep this practical and adjust after the first few doors.'
  const focusLines: Record<string, string> = {
    fresh_hail: 'We’ll look for fresh storm conversations and recent damage signals.',
    follow_ups: 'We’ll start with the warmest follow-ups and revive conversations already started.',
    higher_value: 'We’ll bias toward higher-roof-value opportunities without making assumptions about people.',
    easy_conversations: 'We’ll look for easier conversations first so you can get moving.',
    old_damage: 'We’ll focus on older roof/damage signals and visible exterior concerns.',
    close_to_current_jobs: 'We’ll stay close to current jobs and streets where the company already has context.',
    partner_choice: 'We’ll pick the run around your mindset, the street data, and the best nearby opportunities.',
  }
  const place = input.streetNames.length ? ` on ${input.streetNames.join(', ')}` : ''
  return `${focusLines[input.focus] || focusLines.partner_choice} ${energy} I found ${input.hotCount} stronger candidate(s) and ${input.followCount} follow-up candidate(s)${place}.`
}

function scriptForFocus(focus: string) {
  if (focus === 'fresh_hail') return 'Hey, I’m checking homes nearby after the storm came through. We’re helping homeowners spot possible roof and exterior damage before it turns into a bigger issue.'
  if (focus === 'follow_ups') return 'Hey, I’m circling back from when we were in the area. I had a note to check back and make sure you had what you needed after the storm.'
  if (focus === 'easy_conversations') return 'Hey, quick question — did you notice anything after the storm, or has anyone checked the roof since it came through?'
  if (focus === 'old_damage') return 'Hey, we’re checking a few roofs in the neighborhood because older storm damage can be hard to see from the ground.'
  if (focus === 'higher_value') return 'Hey, we’re helping homeowners in the area verify whether the recent weather affected the roof or exterior before small issues get missed.'
  return 'Hey, we’re working in the neighborhood and helping homeowners understand whether the recent weather affected their roof or exterior.'
}

export async function getStreetResearchRuns(ctx: TenantContext, input: { status?: string | null; limit?: number | null } = {}) {
  const runs = await db.streetResearchRun.findMany({ where: { contractorId: ctx.contractorId, ...(input.status ? { status: input.status } : {}) }, orderBy: { updatedAt: 'desc' }, take: Math.min(Math.max(input.limit ?? 25, 1), 100) })
  return { runs }
}

function buildPropertyResearchCard(run: any, candidates: any[]) {
  const best = candidates[0]
  return {
    cardType: 'property_research_result',
    runId: run.id,
    mode: run.mode,
    status: run.status,
    summary: run.resultSummary,
    confidence: run.confidence,
    bestCandidate: best ? cardCandidate(best) : null,
    candidates: candidates.slice(0, 5).map(cardCandidate),
  }
}

function buildStreetResearchCard(run: any, candidates: any[], streetRun?: any | null) {
  const summary = streetRun ? safeJson<Record<string, any>>(streetRun.candidateSummaryJson, {}) : {}
  return {
    cardType: 'street_game_plan',
    runId: run.id,
    streetRunId: streetRun?.id,
    title: streetRun?.title || 'Street game plan',
    status: streetRun?.status || run.status,
    summary: streetRun?.summary || run.resultSummary,
    recommendedStart: streetRun?.recommendedStart,
    avoidNotes: streetRun?.avoidNotes,
    scriptSuggestion: streetRun?.scriptSuggestion,
    goals: { doors: streetRun?.goalDoors ?? run.goalDoors, conversations: streetRun?.goalConversations ?? run.goalConversations, inspections: streetRun?.goalInspections ?? run.goalInspections },
    totalCandidates: candidates.length,
    hot: summary.hot || candidates.filter(c => c.overallScore >= 55).slice(0, 5).map(cardCandidate),
    followUps: summary.followUps || candidates.filter(c => c.followUpScore >= 25).slice(0, 5).map(cardCandidate),
    avoids: summary.avoids || [],
  }
}
