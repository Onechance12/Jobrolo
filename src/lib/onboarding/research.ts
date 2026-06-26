// =============================================================================
// Company Research — website enrichment
// =============================================================================
// Given a website URL or company name, attempts to extract:
//   - company description (from meta tags / homepage text)
//   - services offered
//   - location / service areas
//   - social profiles
//   - team size indicators
//
// Strategy:
//   1. Fetch the website HTML
//   2. Extract title, meta description, Open Graph tags, visible text
//   3. Pass to AI for structured extraction
//
// No external website-search API dependency — uses fetch plus the configured
// Jobrolo AI provider for structured extraction.
// =============================================================================

import { chatComplete } from '@/lib/ai'

export interface CompanyResearch {
  website?: string
  companyName?: string
  description?: string
  services: string[]
  serviceAreas: string[]
  location?: string
  phone?: string
  email?: string
  socialProfiles: Record<string, string>
  teamSizeEstimate?: string
  businessType?: string  // roofing, restoration, public_adjuster, general_contractor, hvac, plumbing, other
  confidence: number     // 0-100
  source: 'website' | 'ai_inference' | 'none'
  rawSnippet?: string    // first 2000 chars of extracted text
}

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

function extractMeta(html: string): { title?: string; description?: string; ogTitle?: string; ogDescription?: string; ogSiteName?: string } {
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

function extractPhone(text: string): string | undefined {
  const m = text.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.]?\d{4}/)
  return m?.[0]
}

function extractEmail(text: string): string | undefined {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  return m?.[0]
}

/**
 * Research a company by website URL.
 * Returns structured findings or null if the website couldn't be fetched.
 */
export async function researchCompanyByUrl(url: string): Promise<CompanyResearch | null> {
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
  const phone = extractPhone(visibleText)
  const email = extractEmail(visibleText)
  const companyName = meta.ogSiteName || meta.ogTitle || meta.title
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

  return {
    website: fetched.finalUrl,
    companyName,
    description,
    services: aiExtract.services ?? [],
    serviceAreas: aiExtract.serviceAreas ?? [],
    location: aiExtract.location,
    phone,
    email,
    socialProfiles: social,
    teamSizeEstimate: aiExtract.teamSizeEstimate,
    businessType: aiExtract.businessType,
    confidence: visibleText.length > 1000 ? 80 : visibleText.length > 200 ? 60 : 40,
    source: 'website',
    rawSnippet: visibleText.slice(0, 2000),
  }
}

/**
 * Research a company by name only (no website). Uses AI to make educated guesses
 * based on the name — much lower confidence than website research.
 */
export async function researchCompanyByName(name: string): Promise<CompanyResearch | null> {
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
    return {
      companyName: name,
      services: parsed.likelyServices ?? [],
      serviceAreas: [],
      socialProfiles: {},
      businessType: parsed.businessType,
      confidence: Math.min(50, parsed.confidence ?? 30),
      source: 'ai_inference',
    }
  } catch (err) {
    console.warn(`[onboarding/research] name inference failed:`, err)
    return null
  }
}

/**
 * Main entry: try website research first, fall back to name inference.
 */
export async function researchCompany(args: { website?: string; companyName?: string }): Promise<CompanyResearch | null> {
  if (args.website) {
    const result = await researchCompanyByUrl(args.website)
    if (result) return result
  }
  if (args.companyName) {
    return await researchCompanyByName(args.companyName)
  }
  return null
}
