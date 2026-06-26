// =============================================================================
// LLM Provider — pluggable AI model abstraction
// =============================================================================
// Supports:
//   1. z-ai (default, free, built-in SDK) — rate-limited
//   2. openai-compatible (APILayer, OpenAI, Azure, Ollama, etc.)
//      Set LLM_PROVIDER=openai-compatible + LLM_API_KEY + LLM_BASE_URL + LLM_MODEL
//
// APILayer marketplace (https://marketplace.apilayer.com) offers:
//   - Multiple LLM models via OpenAI-compatible API
//   - Higher rate limits than the free z-ai SDK
//   - Set LLM_BASE_URL to the APILayer endpoint
// =============================================================================

import ZAI from 'z-ai-web-dev-sdk'
import { logAIUsage, type AIUsagePurpose } from '@/lib/ai-usage'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  purpose?: AIUsagePurpose
  contractorId?: string | null
  userId?: string | null
  customerId?: string | null
  projectId?: string | null
  documentId?: string | null
}

export interface VisionOptions {
  purpose?: AIUsagePurpose
  contractorId?: string | null
  userId?: string | null
  customerId?: string | null
  projectId?: string | null
  documentId?: string | null
  detail?: 'low' | 'high' | 'auto'
  maxTokens?: number
}

async function imageInputFromLocalReference(imageRef: string, contractorId?: string | null): Promise<string | null> {
  if (!imageRef.startsWith('/')) return null

  const fs = await import('node:fs')
  const path = await import('node:path')
  const { db } = await import('@/lib/db')
  let buf: Buffer | null = null
  let filename = imageRef

  // New private storage URLs: /api/storage/{dir}/{filename}
  const storageMatch = imageRef.match(/^\/api\/storage\/(photos|thumbnails|docs)\/([^/?#]+)$/)
  if (storageMatch) {
    const { readFile, readStoredFile } = await import('@/lib/storage')
    const dir = storageMatch[1]
    filename = storageMatch[2]
    const document = await db.document.findFirst({
      where: {
        ...(contractorId ? { contractorId } : {}),
        OR: [
          { filename },
          { filePath: { endsWith: `/${filename}` } },
          { thumbnailPath: { endsWith: `/${filename}` } },
        ],
      },
      select: { filePath: true, thumbnailPath: true },
    }).catch(() => null)
    const storagePath = dir === 'thumbnails' ? document?.thumbnailPath : document?.filePath
    buf = storagePath ? await readStoredFile(storagePath) : await readFile(filename, dir)
  } else {
    // Legacy public URL fallback only. This does not expose private paths; it just
    // keeps old dev/demo image references working if they still exist.
    try {
      filename = imageRef
      buf = await fs.promises.readFile(path.join(process.cwd(), 'public', imageRef))
    } catch {
      buf = null
    }
  }

  if (!buf) return null

  const ext = path.extname(filename).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

// ---------------------------------------------------------------------------
// Provider configuration from env
// ---------------------------------------------------------------------------

type Provider = 'z-ai' | 'openai-compatible'

export function getConfiguredProviderName(): Provider {
  const p = process.env.LLM_PROVIDER || 'z-ai'
  if (p === 'openai-compatible' || p === 'openai') return 'openai-compatible'
  return 'z-ai'
}

function getProvider(): Provider {
  return getConfiguredProviderName()
}

// ---------------------------------------------------------------------------
// Z-AI provider (default — uses z-ai-web-dev-sdk)
// ---------------------------------------------------------------------------

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null

async function getZai() {
  if (!zaiInstance) zaiInstance = await ZAI.create()
  return zaiInstance
}

async function zaiChatComplete(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const ai = await getZai()
  const res: any = await ai.chat.completions.create({
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2000,
    stream: false,
  })
  return res.choices?.[0]?.message?.content ?? ''
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (APILayer, OpenAI, Azure, Ollama, etc.)
// ---------------------------------------------------------------------------

async function openaiCompatibleChatComplete(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const apiKey = process.env.LLM_API_KEY
  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.LLM_MODEL || 'gpt-4o-mini'

  if (!apiKey) throw new Error('LLM_API_KEY not set — cannot use openai-compatible provider')

  console.log('[ai] openai-compatible request', {
    provider: 'openai-compatible',
    model,
    baseUrl,
    messages: messages.length,
  })

  let data: any = null
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(process.env.LLM_API_LAYER_SUBSCRIPTION_KEY
          ? { 'apikey': process.env.LLM_API_LAYER_SUBSCRIPTION_KEY }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2000,
        stream: false,
      }),
    })

    console.log('[ai] openai-compatible response', {
      provider: 'openai-compatible',
      model,
      status: res.status,
      ok: res.ok,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      const error = `LLM API error ${res.status}: ${errText.slice(0, 200)}`
      await logAIUsage({
        contractorId: opts.contractorId,
        userId: opts.userId,
        customerId: opts.customerId,
        projectId: opts.projectId,
        documentId: opts.documentId,
        purpose: opts.purpose ?? 'chat',
        provider: 'openai-compatible',
        model,
        success: false,
        error,
      })
      throw new Error(error)
    }

    data = await res.json()
  } catch (err) {
    if (!data) {
      await logAIUsage({
        contractorId: opts.contractorId,
        userId: opts.userId,
        customerId: opts.customerId,
        projectId: opts.projectId,
        documentId: opts.documentId,
        purpose: opts.purpose ?? 'chat',
        provider: 'openai-compatible',
        model,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  }
  const content = data.choices?.[0]?.message?.content ?? ''
  await logAIUsage({
    contractorId: opts.contractorId,
    userId: opts.userId,
    customerId: opts.customerId,
    projectId: opts.projectId,
    documentId: opts.documentId,
    purpose: opts.purpose ?? 'chat',
    provider: 'openai-compatible',
    model,
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
    totalTokens: data.usage?.total_tokens ?? null,
    success: true,
  })
  console.log('[ai] openai-compatible response preview', {
    provider: 'openai-compatible',
    model,
    preview: content.slice(0, 500),
  })
  return content
}

// ---------------------------------------------------------------------------
// Vision (image analysis) — supports both providers
// ---------------------------------------------------------------------------

export async function analyzeImage(imageUrl: string, prompt: string, opts: VisionOptions = {}): Promise<string> {
  const provider = getProvider()

  if (provider === 'openai-compatible') {
    console.log('[ai-provider] using openai-compatible for image analysis')
    return await openaiCompatibleVision(imageUrl, prompt, opts)
  }
  console.log('[ai-provider] using z-ai for image analysis')
    return await zaiVision(imageUrl, prompt, opts)
}

async function zaiVision(imageUrl: string, prompt: string, opts: VisionOptions = {}): Promise<string> {
  try {
    const ai = await getZai()
    let imageInput = imageUrl
    if (imageUrl.startsWith('/')) {
      const localInput = await imageInputFromLocalReference(imageUrl, opts.contractorId)
      if (localInput) imageInput = localInput
    }
    const res: any = await (ai.chat.completions as any).createVision({
      messages: [{ role: 'user', content: prompt }],
      image: imageInput,
    })
    return res.choices?.[0]?.message?.content ?? ''
  } catch (err) {
    console.error('[ai] analyzeImage error:', err)
    return ''
  }
}

async function openaiCompatibleVision(imageUrl: string, prompt: string, opts: VisionOptions): Promise<string> {
  try {
    const apiKey = process.env.LLM_API_KEY
    const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
    const model = process.env.LLM_VISION_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini'
    if (!apiKey) return ''

    // Convert local/private storage URL to base64
    let imageInput = imageUrl
    if (imageUrl.startsWith('/')) {
      const localInput = await imageInputFromLocalReference(imageUrl, opts.contractorId)
      if (!localInput) return ''
      imageInput = localInput
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(process.env.LLM_API_LAYER_SUBSCRIPTION_KEY
          ? { 'apikey': process.env.LLM_API_LAYER_SUBSCRIPTION_KEY }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageInput, detail: opts.detail ?? 'low' } },
          ],
        }],
        max_tokens: opts.maxTokens ?? 1000,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[ai] vision error:', res.status)
      await logAIUsage({
        contractorId: opts.contractorId,
        userId: opts.userId,
        customerId: opts.customerId,
        projectId: opts.projectId,
        documentId: opts.documentId,
        purpose: opts.purpose ?? 'image_analysis',
        provider: 'openai-compatible',
        model,
        imageCount: 1,
        success: false,
        error: `vision error ${res.status}: ${errText.slice(0, 200)}`,
      })
      return ''
    }
    const data = await res.json()
    await logAIUsage({
      contractorId: opts.contractorId,
      userId: opts.userId,
      customerId: opts.customerId,
      projectId: opts.projectId,
      documentId: opts.documentId,
      purpose: opts.purpose ?? 'image_analysis',
      provider: 'openai-compatible',
      model,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
      totalTokens: data.usage?.total_tokens ?? null,
      imageCount: 1,
      success: true,
    })
    return data.choices?.[0]?.message?.content ?? ''
  } catch (err) {
    console.error('[ai] vision error:', err)
    return ''
  }
}

// ---------------------------------------------------------------------------
// Main entry point — routes to the configured provider
// ---------------------------------------------------------------------------

export async function chatComplete(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
  const provider = getProvider()
  console.log('[ai] provider selected', {
    provider,
    model: provider === 'openai-compatible' ? (process.env.LLM_MODEL || 'gpt-4o-mini') : 'z-ai-default',
  })
  console.log(`[ai-provider] using ${provider} for ${opts?.purpose === 'tool_reasoning' ? 'tool-call reasoning' : 'chat'}`)

  if (provider === 'openai-compatible') {
    return await openaiCompatibleChatComplete(messages, opts || {})
  }
  return await zaiChatComplete(messages, opts || {})
}

export async function getAI() {
  // Backward compat — returns the z-ai instance for code that needs it directly
  if (getProvider() === 'openai-compatible') {
    console.warn('[ai-provider] z-ai skipped because openai-compatible is configured; use chatComplete/analyzeImage instead of getAI()')
  }
  return await getZai()
}

export async function* streamChat(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<string, string, unknown> {
  if (getProvider() === 'openai-compatible') {
    const content = await openaiCompatibleChatComplete(messages, opts || {})
    yield content
    return content
  }

  const ai = await getZai()
  let fullText = ''
  const stream: any = await ai.chat.completions.create({
    messages,
    stream: true,
    temperature: opts?.temperature ?? 0.4,
    max_tokens: opts?.maxTokens ?? 1200,
  })

  if (stream && typeof stream === 'object' && typeof stream.getReader === 'function') {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sseBuffer += decoder.decode(value, { stream: true })
      let sepIdx
      while ((sepIdx = sseBuffer.indexOf('\n\n')) !== -1) {
        const event = sseBuffer.slice(0, sepIdx)
        sseBuffer = sseBuffer.slice(sepIdx + 2)
        for (const line of event.split('\n')) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim()
            if (jsonStr === '[DONE]') continue
            try {
              const p = JSON.parse(jsonStr)
              const d = p.choices?.[0]?.delta?.content ?? ''
              if (d) { fullText += d; yield d }
            } catch {}
          }
        }
      }
    }
    return fullText
  }

  if (stream?.choices) {
    const c = stream.choices[0]?.message?.content ?? ''
    fullText = c
    yield c
    return c
  }
  return ''
}
