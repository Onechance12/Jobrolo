// =============================================================================
// Company Research — website + web-presence enrichment
// =============================================================================
// Given a website URL or company name, attempts to extract:
//   - company description (from meta tags / homepage text)
//   - services offered
//   - location / service areas
//   - social profiles
//   - team size indicators
//   - broader public web-presence signals when OpenAI web search is configured
//
// Strategy:
//   1. Fetch the website HTML
//   2. Extract title, meta description, Open Graph tags, visible text
//   3. Pass to AI for structured extraction
//
// Uses direct website fetch first. If OpenAI web search is configured, enriches
// with public web-presence signals such as directories, reviews, BBB, blogs,
// backlinks/mentions, and social profiles.
// =============================================================================

import { chatComplete } from '@/lib/ai'
import { isOpenAIWebSearchConfigured, openAIWebSearch, type WebSearchSource } from '@/lib/openai-web-search'

export interface CompanyWebPresence {
  enabled: boolean
  provider?: string
  summary?: string
  phone?: string
  email?: string
  logoUrl?: string
  googleReviews?: { found?: boolean; rating?: string; reviewCount?: string; url?: string; notes?: string }
  reviews?: Array<{ source?: string; rating?: string; reviewCount?: string; url?: string; notes?: string }>
  socialSignals?: Array<{ platform?: string; url?: string; status?: string; notes?: string; recentActivity?: string }>
  contentSignals?: Array<{ channel?: string; title?: string; url?: string; notes?: string }>
  directoryListings?: Array<{ source?: string; url?: string; notes?: string }>
  mentions?: Array<{ title?: string; url?: string; notes?: string }>
  backlinksOrBlogs?: Array<{ title?: string; url?: string; notes?: string }>
  bbb?: { found?: boolean; rating?: string; url?: string; notes?: string }
  warnings?: string[]
  sources: WebSearchSource[]
  error?: string
}

export interface CompanyResearch {
  website?: string
  companyName?: string
  description?: string
  services: string[]
  serviceAreas: string[]
  location?: string
  phone?: string
  email?: string
  logoUrl?: string
  socialProfiles: Record<string, string>
  teamSizeEstimate?: string
  businessType?: string  // roofing, restoration, public_adjuster, general_contractor, hvac, plumbing, other
  confidence: number     // 0-100
  source: 'website' | 'ai_inference' | 'none'
  webPresence?: CompanyWebPresence
  rawSnippet?: string    // first 2000 chars of extracted text
}

export type CompanyResearchMode = 'cheap' | 'normal' | 'deep'

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]

function normalizeUrl(url: string): string {
  let u = url.trim()
  if (!u) return u
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  return u
}

async function fetchWebsite(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return null
    const html = await res.text()
    return { html, finalUrl: res.url }
  } catch {
    return null
  }
}

function extractTextFromHtml(html: string): string {
  // Remove script/style/nav/footer
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
  // Remove all tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ')
  // Decode common entities
  cleaned = cleaned.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  // Collapse whitespace
  return cleaned.replace(/\s+/g, ' ').trim()
}

function extractMeta(html: string): { title?: string; description?: string; ogTitle?: string; ogDescription?: string; ogSiteName?: string; ogImage?: string } {
  const result: any = {}
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (titleMatch) result.title = titleMatch[1].trim()
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
  if (descMatch) result.description = descMatch[1].trim()
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (ogTitleMatch) result.ogTitle = ogTitleMatch[1].trim()
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  if (ogDescMatch) result.ogDescription = ogDescMatch[1].trim()
  const ogSiteMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
  if (ogSiteMatch) result.ogSiteName = ogSiteMatch[1].trim()
  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  if (ogImageMatch) result.ogImage = ogImageMatch[1].trim()
  return result
}

function extractSocialLinks(html: string): Record<string, string> {
  const social: Record<string, string> = {}
  const patterns: Array<[string, RegExp]> = [
    ['facebook', /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._\-\/]+/i],
    ['instagram', /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._\-\/]+/i],
    ['twitter', /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9._\-\/]+/i],
    ['linkedin', /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9._\-\/]+/i],
    ['youtube', /https?:\/\/(?:www\.)?youtube\.com\/[A-Za-z0-9._\-\/]+/i],
    ['yelp', /https?:\/\/(?:www\.)?yelp\.com\/biz\/[A-Za-z0-9._\-\/]+/i],
  ]
  const seen = new Set<string>()
  for (const [name, pattern] of patterns) {
    const matches = html.match(pattern)
    if (matches && matches[0] && !seen.has(matches[0])) {
      social[name] = matches[0].replace(/["'<>].*$/, '')
      seen.add(matches[0])
    }
  }
  return social
}

function absoluteUrl(base: string, maybeUrl?: string | null): string | undefined {
  if (!maybeUrl) return undefined
  const value = maybeUrl.trim()
  if (!value || /^data:/i.test(value)) return undefined
  try {
    return new URL(value, base).toString()
  } catch {
    return undefined
  }
}

function extractLogoUrl(html: string, baseUrl: string, meta: ReturnType<typeof extractMeta>): string | undefined {
  const fromMeta = absoluteUrl(baseUrl, meta.ogImage)
  if (fromMeta && /logo|brand|sons|roof/i.test(fromMeta)) return fromMeta

  const imgRegex = /<img\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0]
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? ''
    const className = tag.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? ''
    if (!src) continue
    const signal = `${src} ${alt} ${className}`
    if (/logo|brand|site-logo|custom-logo/i.test(signal)) {
      return absoluteUrl(baseUrl, src)
    }
  }

  return fromMeta
}

function extractPhone(htmlOrText: string): string | undefined {
  const tel = htmlOrText.match(/href=["']tel:([^"']+)["']/i)?.[1]
  if (tel) return tel.replace(/^\/\//, '').replace(/[^\d+().\-\s]/g, '').trim()
  const m = htmlOrText.match(/\+?1?[\s.-]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)
  return m?.[0]?.trim()
}

function extractEmail(htmlOrText: string): string | undefined {
  const mailto = htmlOrText.match(/href=["']mailto:([^"'?]+)(?:\?[^"']*)?["']/i)?.[1]
  if (mailto) return mailto.trim()
  const m = htmlOrText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  return m?.[0]?.trim()
}

function cleanCompanyNameCandidate(value?: string | null): string | undefined {
  const base = value
    ?.replace(/\s+/g, ' ')
    .replace(/\s+\|\s+.*$/, '')
    .replace(/\s+–\s+.*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+—\s+.*$/, '')
    .trim()
  return base || undefined
}

function parseJsonObject(raw: string): any | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim()
  const candidate = fenced || trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
}

function textKey(value?: string | null) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(co|company|llc|inc|ltd|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugKey(value?: string | null) {
  return textKey(value).replace(/\s+/g, '-')
}

function hostFromUrl(value?: string | null) {
  if (!value) return undefined
  try {
    return new URL(normalizeUrl(value)).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return undefined
  }
}

function parsedUrl(value?: string | null) {
  if (!value) return null
  try {
    return new URL(normalizeUrl(value))
  } catch {
    return null
  }
}

function titleUrlText(entry: any) {
  return [entry?.title, entry?.source, entry?.notes, entry?.snippet, entry?.url].filter(Boolean).join(' ')
}

function canonicalSourceUrl(value?: string | null) {
  const url = parsedUrl(value)
  if (!url) return undefined
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'msclkid'].includes(key.toLowerCase())) {
      url.searchParams.delete(key)
    }
  }
  return url.toString().replace(/\/$/, '')
}

function pathSegments(url: string) {
  const parsed = parsedUrl(url)
  if (!parsed) return []
  return parsed.pathname.split('/').map(segment => segment.toLowerCase()).filter(Boolean)
}

function isRelevantCompanySource(entry: any, input: { companyName?: string; website?: string }) {
  const url = typeof entry?.url === 'string' ? entry.url : ''
  const host = hostFromUrl(url)
  const websiteHost = hostFromUrl(input.website)
  if (websiteHost && host === websiteHost) return true

  const company = textKey(input.companyName)
  if (!company) return true
  const text = textKey(titleUrlText(entry))
  const compactCompany = company.replace(/\s+/g, '')
  const companySlug = slugKey(input.companyName)
  const segments = pathSegments(url)
  const path = segments.join('/')

  // Directory/search results often contain similarly named businesses. For BBB,
  // require the exact company slug so similarly named companies do not sneak in
  // when the saved company name is shorter or more generic.
  if (host?.includes('bbb.org') && companySlug) {
    return segments.some(segment => segment === companySlug || segment.startsWith(`${companySlug}-`))
  }

  if (host?.includes('linkedin.com') || host?.includes('facebook.com') || host?.includes('instagram.com') || host?.includes('youtube.com') || host?.includes('yelp.com')) {
    return Boolean(companySlug && segments.includes(companySlug)) || Boolean(compactCompany && segments.includes(compactCompany))
  }

  if (compactCompany && /(?:directory|profile|company|business|reviews?|biz)/i.test(path)) {
    return segments.includes(companySlug) || segments.includes(compactCompany)
  }

  if (text.includes(company)) return true
  return Boolean(companySlug && segments.includes(companySlug))
}

function filterRelevantEntries<T extends { url?: string | null }>(entries: T[] | undefined, input: { companyName?: string; website?: string }, limit: number) {
  const seen = new Set<string>()
  const out: T[] = []
  for (const entry of entries ?? []) {
    if (!isRelevantCompanySource(entry, input)) continue
    const key = canonicalSourceUrl(entry.url) || titleUrlText(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
    if (out.length >= limit) break
  }
  return out
}

function searchConfigForMode(mode: CompanyResearchMode | undefined) {
  if (mode === 'cheap') return { searchContextSize: 'low' as const, maxOutputTokens: 1400 }
  if (mode === 'deep') return { searchContextSize: 'high' as const, maxOutputTokens: 3200 }
  return { searchContextSize: 'medium' as const, maxOutputTokens: 2200 }
}

async function researchCompanyWebPresence(input: { companyName?: string; website?: string; location?: string; searchMode?: CompanyResearchMode }): Promise<CompanyWebPresence> {
  if (!isOpenAIWebSearchConfigured()) {
    return {
      enabled: false,
      sources: [],
      error: 'OpenAI web search is not configured. Set LLM_PROVIDER=openai-compatible, LLM_BASE_URL=https://api.openai.com/v1, and LLM_API_KEY.',
    }
  }

  const company = input.companyName || input.website || 'the company'
  const prompt = `Research the public web presence for this contractor/company.

Company: ${company}
Website: ${input.website || 'unknown'}
Likely location/service area: ${input.location || 'unknown'}

Find public information from the broader web, not only the company homepage. Only include sources for this exact company. Exclude similarly named companies unless the source clearly matches the official website/domain or exact company identity.
Look for:
- official website confirmation
- phone, public email, and logo/brand image if available
- Google Business Profile / Google review rating and review count if visible in search results
- Google/Yelp/Facebook/Angi/HomeAdvisor/other review signals when available
- BBB profile or BBB rating when available
- social profiles and visible public activity signals from Facebook, Instagram, TikTok, YouTube, LinkedIn, and X when available
- recent public content/post/video/blog signals if visible; never claim exact counts unless source-backed
- directory listings
- blogs/articles/news/backlinks/mentions about the company
- service areas and services

Do not invent ratings, review counts, BBB status, exact social post counts, traffic, attribution, or private analytics. If unavailable, say unavailable.
Return JSON only:
{
  "summary": "short practical summary",
  "phone": "public phone if found",
  "email": "public email if found",
  "logoUrl": "official logo or brand image URL if found",
  "googleReviews": {"found": true, "rating":"...", "reviewCount":"...", "url":"...", "notes":"..."},
  "reviews": [{"source":"...", "rating":"...", "reviewCount":"...", "url":"...", "notes":"..."}],
  "socialSignals": [{"platform":"Facebook|Instagram|TikTok|YouTube|LinkedIn|X|Other", "url":"...", "status":"active|inactive|found|not_found|uncertain", "recentActivity":"what is visibly recent if source-backed", "notes":"..."}],
  "contentSignals": [{"channel":"blog|video|social|directory|news", "title":"...", "url":"...", "notes":"..."}],
  "directoryListings": [{"source":"...", "url":"...", "notes":"..."}],
  "mentions": [{"title":"...", "url":"...", "notes":"..."}],
  "backlinksOrBlogs": [{"title":"...", "url":"...", "notes":"..."}],
  "bbb": {"found": true, "rating":"...", "url":"...", "notes":"..."},
  "warnings": ["anything uncertain, conflicting, or requiring human review"]
}`

  const searchConfig = searchConfigForMode(input.searchMode)
  const result = await openAIWebSearch(prompt, {
    searchContextSize: searchConfig.searchContextSize,
    maxOutputTokens: searchConfig.maxOutputTokens,
    forceSearch: true,
  })

  if (!result.ok) {
    return { enabled: true, provider: result.provider, sources: [], error: result.error || 'OpenAI web search failed.' }
  }

  const parsed = parseJsonObject(result.text) || {}
  const filterInput = { companyName: input.companyName, website: input.website }
  const sources = filterRelevantEntries(result.sources, filterInput, 12)
  const bbb = parsed.bbb && typeof parsed.bbb === 'object' && isRelevantCompanySource(parsed.bbb, filterInput) ? parsed.bbb : undefined
  const googleReviews = parsed.googleReviews && typeof parsed.googleReviews === 'object' ? parsed.googleReviews : undefined
  return {
    enabled: true,
    provider: `${result.provider}:${result.model}`,
    summary: typeof parsed.summary === 'string' ? parsed.summary : result.text.slice(0, 800),
    phone: typeof parsed.phone === 'string' ? parsed.phone : undefined,
    email: typeof parsed.email === 'string' ? parsed.email : undefined,
    logoUrl: typeof parsed.logoUrl === 'string' ? parsed.logoUrl : undefined,
    googleReviews,
    reviews: Array.isArray(parsed.reviews) ? filterRelevantEntries(parsed.reviews, filterInput, 10) : [],
    socialSignals: Array.isArray(parsed.socialSignals) ? filterRelevantEntries(parsed.socialSignals, filterInput, 12) : [],
    contentSignals: Array.isArray(parsed.contentSignals) ? filterRelevantEntries(parsed.contentSignals, filterInput, 12) : [],
    directoryListings: Array.isArray(parsed.directoryListings) ? filterRelevantEntries(parsed.directoryListings, filterInput, 10) : [],
    mentions: Array.isArray(parsed.mentions) ? filterRelevantEntries(parsed.mentions, filterInput, 10) : [],
    backlinksOrBlogs: Array.isArray(parsed.backlinksOrBlogs) ? filterRelevantEntries(parsed.backlinksOrBlogs, filterInput, 10) : [],
    bbb,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((x: unknown) => typeof x === 'string').slice(0, 10) : [],
    sources,
  }
}

/**
 * Research a company by website URL.
 * Returns structured findings or null if the website couldn't be fetched.
 */
export async function researchCompanyByUrl(url: string, opts: { preferredCompanyName?: string; includeWebPresence?: boolean; searchMode?: CompanyResearchMode } = {}): Promise<CompanyResearch | null> {
  const normalized = normalizeUrl(url)
  console.log(`[onboarding/research] fetching ${normalized}...`)
  const fetched = await fetchWebsite(normalized)
  if (!fetched) {
    console.log(`[onboarding/research] could not fetch ${normalized}`)
    return null
  }

  const meta = extractMeta(fetched.html)
  const visibleText = extractTextFromHtml(fetched.html)
  const social = extractSocialLinks(fetched.html)
  const phone = extractPhone(fetched.html) || extractPhone(visibleText)
  const email = extractEmail(fetched.html) || extractEmail(visibleText)
  const logoUrl = extractLogoUrl(fetched.html, fetched.finalUrl, meta)
  const companyName = opts.preferredCompanyName || cleanCompanyNameCandidate(meta.ogSiteName || meta.ogTitle || meta.title)
  const description = meta.ogDescription || meta.description

  console.log(`[onboarding/research] fetched ${visibleText.length} chars from ${fetched.finalUrl}`)

  // AI extraction for structured fields (services, service areas, business type, team size)
  let aiExtract: {
    services?: string[]
    serviceAreas?: string[]
    location?: string
    businessType?: string
    teamSizeEstimate?: string
  } = {}

  if (visibleText.length > 100) {
    try {
      const aiResponse = await chatComplete([
        {
          role: 'system',
          content: `Analyze this website text from a contractor/contractor-adjacent company. Extract structured info as JSON only (no markdown):
{
  "services": ["list of services they offer"],
  "serviceAreas": ["cities/regions they serve"],
  "location": "primary location if found, else null",
  "businessType": "one of: roofing, restoration, public_adjuster, general_contractor, hvac, plumbing, siding, gutters, painting, electrical, other",
  "teamSizeEstimate": "small (1-5) | medium (6-25) | large (26-100) | enterprise (100+) | unknown"
}
Only include fields you can confidently identify from the text. Omit fields you can't determine.`,
        },
        { role: 'user', content: visibleText.slice(0, 6000) },
      ], { temperature: 0.1, maxTokens: 600 })

      let c = aiResponse.trim()
      if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
      aiExtract = JSON.parse(c)
      console.log(`[onboarding/research] AI extracted: businessType=${aiExtract.businessType}, ${aiExtract.services?.length ?? 0} services, ${aiExtract.serviceAreas?.length ?? 0} areas`)
    } catch (err) {
      console.warn(`[onboarding/research] AI extraction failed:`, err)
    }
  }

  const result: CompanyResearch = {
    website: fetched.finalUrl,
    companyName,
    description,
    services: aiExtract.services ?? [],
    serviceAreas: aiExtract.serviceAreas ?? [],
    location: aiExtract.location,
    phone,
    email,
    logoUrl,
    socialProfiles: social,
    teamSizeEstimate: aiExtract.teamSizeEstimate,
    businessType: aiExtract.businessType,
    confidence: visibleText.length > 1000 ? 80 : visibleText.length > 200 ? 60 : 40,
    source: 'website',
    rawSnippet: visibleText.slice(0, 2000),
  }
  if (opts.includeWebPresence !== false) {
    result.webPresence = await researchCompanyWebPresence({
      companyName: opts.preferredCompanyName || companyName,
      website: fetched.finalUrl,
      location: aiExtract.location,
      searchMode: opts.searchMode,
    }).catch(err => ({
      enabled: true,
      sources: [],
      error: err instanceof Error ? err.message : String(err),
    }))
    result.phone = result.phone || result.webPresence.phone
    result.email = result.email || result.webPresence.email
    result.logoUrl = result.logoUrl || result.webPresence.logoUrl
  }
  return result
}

/**
 * Research a company by name only (no website). Uses AI to make educated guesses
 * based on the name — much lower confidence than website research.
 */
export async function researchCompanyByName(name: string, opts: { includeWebPresence?: boolean; searchMode?: CompanyResearchMode } = {}): Promise<CompanyResearch | null> {
  if (!name || name.trim().length < 2) return null
  console.log(`[onboarding/research] inferring business type from name: "${name}"`)

  try {
    const aiResponse = await chatComplete([
      {
        role: 'system',
        content: `Based on the company name, infer the most likely business type. Respond as JSON only:
{
  "businessType": "one of: roofing, restoration, public_adjuster, general_contractor, hvac, plumbing, siding, gutters, painting, electrical, other",
  "likelyServices": ["1-3 most likely services"],
  "confidence": 0-100
}
This is a best-guess inference from the name only — keep confidence modest.`,
      },
      { role: 'user', content: `Company name: ${name}` },
    ], { temperature: 0.1, maxTokens: 300 })

    let c = aiResponse.trim()
    if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(c)
    const result: CompanyResearch = {
      companyName: name,
      services: parsed.likelyServices ?? [],
      serviceAreas: [],
      socialProfiles: {},
      businessType: parsed.businessType,
      confidence: Math.min(50, parsed.confidence ?? 30),
      source: 'ai_inference',
    }
    if (opts.includeWebPresence !== false) {
      result.webPresence = await researchCompanyWebPresence({ companyName: name, searchMode: opts.searchMode }).catch(err => ({
        enabled: true,
        sources: [],
        error: err instanceof Error ? err.message : String(err),
      }))
      result.phone = result.webPresence.phone
      result.email = result.webPresence.email
      result.logoUrl = result.webPresence.logoUrl
    }
    return result
  } catch (err) {
    console.warn(`[onboarding/research] name inference failed:`, err)
    return null
  }
}

/**
 * Main entry: try website research first, fall back to name inference.
 */
export async function researchCompany(args: { website?: string; companyName?: string; preferredCompanyName?: string; includeWebPresence?: boolean; searchMode?: CompanyResearchMode }): Promise<CompanyResearch | null> {
  const preferredCompanyName = args.preferredCompanyName || args.companyName
  if (args.website) {
    const result = await researchCompanyByUrl(args.website, { preferredCompanyName, includeWebPresence: args.includeWebPresence, searchMode: args.searchMode })
    if (result) return result
  }
  if (args.companyName) {
    return await researchCompanyByName(args.companyName, { includeWebPresence: args.includeWebPresence, searchMode: args.searchMode })
  }
  return null
}
