import { NextRequest, NextResponse } from 'next/server'
import { chatComplete, type ChatMessage } from '@/lib/ai'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { sanitizeAIOutput, sanitizeUserInput } from '@/lib/security/prompt-defense'

export const runtime = 'nodejs'
export const maxDuration = 30

const FALLBACK =
  "I can help with Jobrolo questions before you create an account. Jobrolo is a chat-first contractor operating system: once you're signed in and onboarded, you can use chat to create clients, projects, shared chats, upload files/photos, build reports, track approvals, and coordinate field work. To continue, choose Sign in or Create workspace."

export async function POST(req: NextRequest) {
  const limited = rateLimitByIp(req, '/api/public/entry-chat')
  if (limited) return limited

  let rawMessage = ''
  try {
    const body = await req.json()
    rawMessage = String(body?.message ?? '')
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const sanitized = sanitizeUserInput(rawMessage)
  const message = sanitized.text.trim().slice(0, 2000)
  if (!message) return NextResponse.json({ error: 'Message is required.' }, { status: 400 })

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are Jobrolo in public account-entry / lobby mode.

Your job:
- Answer questions about Jobrolo, what it does, how it works, onboarding, roles, invites, setup, and what the user can do after signing in.
- Keep answers concise, friendly, and practical. This is a sales/onboarding lobby, so make the product feel useful without overselling.
- Encourage chat-first workflows: users can ask Jobrolo to create clients, jobs, shared chats, reports, scopes, inspections, uploads, approvals, and field notes after setup.
- Make clear that company data, files, customer records, project tools, and real actions require signing in and completing onboarding.
- Do not use markdown syntax. Do not use **bold**, tables, code blocks, JSON, or raw bullets with asterisks.
- If listing features, use short lines like "Client files: Create and find customer/job records from chat." The frontend will turn these into cards.
- Prefer 3 to 6 strong feature examples over long generic lists.

Hard boundaries:
- Do not claim to create, save, fetch, update, delete, upload, invite, or access any real records in lobby mode.
- Do not ask for passwords or sensitive secrets.
- If the user wants account access, tell them to choose Sign in, Create workspace, or use their invite link.
- If asked about pricing or exact current product claims you cannot verify, answer generally and say setup/testing details may change.`,
    },
    { role: 'user', content: message },
  ]

  try {
    const answer = await chatComplete(messages, {
      purpose: 'chat',
      maxTokens: 450,
      temperature: 0.25,
    })
    return NextResponse.json({ message: sanitizeAIOutput(answer || FALLBACK) })
  } catch (err) {
    console.error('[entry-chat] failed:', err)
    return NextResponse.json({ message: FALLBACK })
  }
}
