import { logAIUsage } from '@/lib/ai-usage'

export type WebSearchSource = {
  title?: string | null
  url?: string | null
  snippet?: string | null
  source?: string | null
}

export type OpenAIWebSearchResult = {
  ok: boolean
  text: string
  sources: WebSearchSource[]
  model: string
  provider: 'openai-compatible'
  error?: string | null
}

export type OpenAIWebSearchOptions = {
  contractorId?: string | null
  userId?: string | null
  customerId?: string | null
  projectId?: string | null
  documentId?: string | null
  searchContextSize?: 'low' | 'medium' | 'high'
  timeoutMs?: number
  allowedDomains?: string[]
  blockedDomains?: string[]
  maxOutputTokens?: number
  forceSearch?: boolean
  userLocation?: {
    country?: string
    region?: string
    city?: string
    timezone?: string
  }
}

function openAIBaseUrl() {
  return (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
}

export function isOpenAIWebSearchConfigured() {
  const provider = process.env.LLM_PROVIDER || ''
  const baseUrl = openAIBaseUrl()
  return (
    (provider === 'openai-compatible' || provider === 'openai') &&
    !!process.env.LLM_API_KEY &&
    /^https:\/\/api\.openai\.com\/v1$/i.test(baseUrl)
  )
}

function cleanDomains(domains?: string[]) {
  return (domains || [])
    .map(domain => String(domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
    .filter(Boolean)
    .slice(0, 100)
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text
  const chunks: string[] = []
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (typeof item?.text === 'string') chunks.push(item.text)
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string') chunks.push(content.text)
      if (typeof content?.output_text === 'string') chunks.push(content.output_text)
    }
  }
  return chunks.join('\n').trim()
}

function addSource(out: WebSearchSource[], value: any) {
  const url = value?.url || value?.uri || value?.link || value?.source_website_url
  if (!url || typeof url !== 'string') return
  if (out.some(existing => existing.url === url)) return
  out.push({
    title: value?.title || value?.name || value?.caption || null,
    url,
    snippet: value?.snippet || value?.text || value?.caption || null,
    source: value?.source || value?.type || null,
  })
}

function extractSources(data: any): WebSearchSource[] {
  const out: WebSearchSource[] = []
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const result of Array.isArray(item?.results) ? item.results : []) addSource(out, result)
    for (const source of Array.isArray(item?.action?.sources) ? item.action.sources : []) addSource(out, source)
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) addSource(out, annotation)
    }
  }
  for (const source of Array.isArray(data?.sources) ? data.sources : []) addSource(out, source)
  return out.slice(0, 25)
}

function usageFromResponses(data: any) {
  const usage = data?.usage || {}
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  }
}

export async function openAIWebSearch(prompt: string, opts: OpenAIWebSearchOptions = {}): Promise<OpenAIWebSearchResult> {
  const apiKey = process.env.LLM_API_KEY
  const baseUrl = openAIBaseUrl()
  // Keep chat on LLM_MODEL, but default public web research to the current
  // Responses API web-search model. Render can override with LLM_WEB_SEARCH_MODEL
  // if pricing/model availability needs to be tuned.
  const model = process.env.LLM_WEB_SEARCH_MODEL || process.env.OPENAI_WEB_SEARCH_MODEL || 'gpt-5.5'
  const searchContextSize = opts.searchContextSize || (process.env.LLM_WEB_SEARCH_CONTEXT as 'low' | 'medium' | 'high' | undefined) || 'medium'

  if (!isOpenAIWebSearchConfigured() || !apiKey) {
    return { ok: false, text: '', sources: [], model, provider: 'openai-compatible', error: 'OpenAI web search is not configured. Set LLM_PROVIDER=openai-compatible, LLM_BASE_URL=https://api.openai.com/v1, and LLM_API_KEY.' }
  }

  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs ?? Number(process.env.LLM_WEB_SEARCH_TIMEOUT_MS || 20_000)
  const timeout = setTimeout(() => controller.abort(), Math.max(5_000, Math.min(timeoutMs, 60_000)))
  const allowedDomains = cleanDomains(opts.allowedDomains)
  const blockedDomains = cleanDomains(opts.blockedDomains)
  const filters = allowedDomains.length || blockedDomains.length
    ? {
        ...(allowedDomains.length ? { allowed_domains: allowedDomains } : {}),
        ...(blockedDomains.length ? { blocked_domains: blockedDomains } : {}),
      }
    : undefined

  console.log('[web-search] openai request', {
    provider: 'openai-compatible',
    model,
    searchContextSize,
    forced: opts.forceSearch !== false,
    allowedDomains: allowedDomains.length,
    blockedDomains: blockedDomains.length,
  })

  try {
    const res = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        tools: [{
          type: 'web_search',
          search_context_size: searchContextSize,
          ...(opts.userLocation ? { user_location: { type: 'approximate', ...opts.userLocation } } : {}),
          ...(filters ? { filters } : {}),
        }],
        tool_choice: opts.forceSearch === false ? 'auto' : 'required',
        include: ['web_search_call.action.sources'],
        max_output_tokens: opts.maxOutputTokens ?? 1800,
      }),
      signal: controller.signal,
    })

    const textBody = await res.text()
    let data: any = {}
    try { data = textBody ? JSON.parse(textBody) : {} } catch { data = {} }

    console.log('[web-search] openai response', { model, status: res.status, ok: res.ok })

    if (!res.ok) {
      const error = `OpenAI web search error ${res.status}: ${textBody.slice(0, 500)}`
      console.warn('[web-search] openai error', {
        model,
        status: res.status,
        errorPreview: textBody.slice(0, 500),
      })
      await logAIUsage({
        contractorId: opts.contractorId,
        userId: opts.userId,
        customerId: opts.customerId,
        projectId: opts.projectId,
        documentId: opts.documentId,
        purpose: 'web_search',
        provider: 'openai-compatible',
        model,
        webSearchCalls: 1,
        success: false,
        error,
      })
      return { ok: false, text: '', sources: [], model, provider: 'openai-compatible', error }
    }

    const text = extractOutputText(data)
    const sources = extractSources(data)
    const usage = usageFromResponses(data)
    await logAIUsage({
      contractorId: opts.contractorId,
      userId: opts.userId,
      customerId: opts.customerId,
      projectId: opts.projectId,
      documentId: opts.documentId,
      purpose: 'web_search',
      provider: 'openai-compatible',
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      webSearchCalls: 1,
      success: true,
    })
    console.log('[web-search] openai result preview', { model, sources: sources.length, preview: text.slice(0, 400) })
    return { ok: true, text, sources, model, provider: 'openai-compatible' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logAIUsage({
      contractorId: opts.contractorId,
      userId: opts.userId,
      customerId: opts.customerId,
      projectId: opts.projectId,
      documentId: opts.documentId,
      purpose: 'web_search',
      provider: 'openai-compatible',
      model,
      webSearchCalls: 1,
      success: false,
      error: message,
    })
    console.error('[web-search] openai failed', { model, error: message })
    return { ok: false, text: '', sources: [], model, provider: 'openai-compatible', error: message }
  } finally {
    clearTimeout(timeout)
  }
}
