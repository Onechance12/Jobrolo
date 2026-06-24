import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { requireContext } from '@/lib/security/context'
import { rateLimit } from '@/lib/security/rate-limit'
export const runtime = 'nodejs'
export const maxDuration = 30

const CACHE_DIR = path.join(process.cwd(), 'public', 'uploads', 'tts-cache')
const VALID_VOICES = new Set(['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'])

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const rl = rateLimit(ctx.contractorId, '/api/tts')
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  const { text, voice = 'tongtong', speed = 1.0 } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })
  if (text.length > 1024) return NextResponse.json({ error: 'Text too long (max 1024 chars)' }, { status: 400 })

  const truncated = text.slice(0, 1024)
  const safeVoice = VALID_VOICES.has(voice) ? voice : 'tongtong'
  const safeSpeed = Math.min(2.0, Math.max(0.5, Number(speed) || 1.0))
  const hash = crypto.createHash('sha256').update(`${safeVoice}:${safeSpeed}:${truncated}`).digest('hex').slice(0, 32)
  const cachePath = path.join(CACHE_DIR, `${hash}.wav`)
  const cacheUrl = `/uploads/tts-cache/${hash}.wav`

  try { await fs.access(cachePath); return NextResponse.json({ success: true, url: cacheUrl, cached: true }) } catch {}
  await fs.mkdir(CACHE_DIR, { recursive: true })

  // Only use z-ai for TTS (APILayer doesn't have TTS)
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const response = await zai.audio.tts.create({ input: truncated, voice: safeVoice, speed: safeSpeed, response_format: 'wav', stream: false })
    const buffer = Buffer.from(new Uint8Array(await response.arrayBuffer()))
    await fs.writeFile(cachePath, buffer)
    return NextResponse.json({ success: true, url: cacheUrl, cached: false, size: buffer.length })
  } catch (err) {
    console.error('[tts]:', err)
    // Don't leak upstream errors to client
    return NextResponse.json({ error: 'TTS service temporarily unavailable' }, { status: 503 })
  }
}
