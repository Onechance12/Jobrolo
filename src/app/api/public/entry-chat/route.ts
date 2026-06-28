import { NextRequest, NextResponse } from 'next/server'
import { chatComplete, type ChatMessage } from '@/lib/ai'
import { buildCodyPacket, codyBlockOpeningContent, inferCodyArea, inferCodySeverity, isCodyBlockCloseText, isCodyBlockOpenText } from '@/lib/cody/packet'
import { createRoleNotification } from '@/lib/notifications'
import { rateLimitByIp } from '@/lib/security/rate-limit'
import { requireContext } from '@/lib/security/context'
import { sanitizeAIOutput, sanitizeUserInput } from '@/lib/security/prompt-defense'

export const runtime = 'nodejs'
export const maxDuration = 30

const FALLBACK =
  "Jobrolo is a chat-first operating system for contractors. The idea is simple: instead of hunting through CRM menus, you tell Jobrolo what you want done — create a client, start a job, organize photos, build a report, coordinate a crew, or find what needs attention. In this lobby I can explain how it works and answer questions. Real company data and actions unlock after sign-in."

const PUBLIC_ENTRY_MAX_BODY_BYTES = 16 * 1024
const PUBLIC_ENTRY_MAX_MESSAGE_CHARS = 2000

type PublicEntryRecentMessage = { role: 'user' | 'assistant'; text: string }

function safeRecentMessages(value: unknown): PublicEntryRecentMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const record = entry as Record<string, unknown>
      const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null
      const text = typeof record.text === 'string'
        ? sanitizeUserInput(record.text).text.trim().slice(0, 1200)
        : typeof record.content === 'string'
          ? sanitizeUserInput(record.content).text.trim().slice(0, 1200)
          : ''
      return role && text ? { role, text } : null
    })
    .filter((entry): entry is PublicEntryRecentMessage => Boolean(entry))
    .slice(-20)
}

function safeUrl(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, 1000)
  if (!/^https?:\/\//i.test(trimmed)) return null
  return trimmed
}

async function savePublicCodySession(req: NextRequest, content: string, recentMessages: PublicEntryRecentMessage[], currentUrl: string | null) {
  const ctx = await requireContext(req).catch(() => null)
  if (!ctx || !ctx.user) return { saved: false as const, reason: 'not_authenticated' as const }

  const area = inferCodyArea(content, 'onboarding/auth')
  const severity = inferCodySeverity(content)
  const summary = content.length > 280 ? `${content.slice(0, 277)}...` : content
  const debugContext = {
    source: 'public_entry_chat',
    route: '/signup',
    currentUrl,
    recentMessages,
    userId: ctx.user.id,
    userRole: ctx.user.role,
  }
  const codyPacket = buildCodyPacket({
    content,
    area,
    severity,
    title: `Note to Cody: ${area}`,
    company: ctx.contractor.company || ctx.contractor.name || null,
    currentUrl,
    debugContext,
    recentMessages,
    relevantIds: {
      contractorId: ctx.contractorId,
      userId: ctx.user.id,
      source: 'public_entry_chat',
    },
  })

  const item = await createRoleNotification({
    contractorId: ctx.contractorId,
    role: 'owner',
    userId: null,
    type: 'tester_feedback',
    title: `Note to Cody: ${area}`,
    summary,
    priority: severity,
    relatedType: 'tester_feedback',
    payload: {
      cardType: 'tester_feedback',
      content,
      source: 'note_to_cody',
      area,
      severity,
      currentUrl,
      debugContext,
      codyPacket,
      capturedByUserId: ctx.user.id,
      capturedByRole: ctx.user.role,
      capturedAt: new Date().toISOString(),
    },
  })
  return { saved: true as const, itemId: item.id, area, severity }
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_ENABLED === 'false') {
    console.error('[entry-chat] public entry chat refused because RATE_LIMIT_ENABLED=false in production')
    return NextResponse.json({ error: 'Public entry chat is temporarily unavailable.' }, { status: 503 })
  }

  const contentLength = Number(req.headers.get('content-length') || '0')
  if (Number.isFinite(contentLength) && contentLength > PUBLIC_ENTRY_MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Message is too large.' }, { status: 413 })
  }

  const limited = rateLimitByIp(req, '/api/public/entry-chat')
  if (limited) return limited

  let rawMessage = ''
  try {
    const body = await req.json()
    rawMessage = String(body?.message ?? '')
    const recentMessages = safeRecentMessages(body?.recentMessages)
    const currentUrl = safeUrl(body?.currentUrl)
    const requestedMode = body?.mode === 'cody' || isCodyBlockOpenText(rawMessage) || isCodyBlockCloseText(rawMessage) ? 'cody' : 'normal'
    const codyClosing = Boolean(body?.codyClosing) || isCodyBlockCloseText(rawMessage)
    const codySessionContent = typeof body?.codySessionContent === 'string'
      ? sanitizeUserInput(body.codySessionContent).text.trim().slice(0, 10000)
      : ''

    if (requestedMode === 'cody') {
      const sanitized = sanitizeUserInput(rawMessage)
      const message = sanitized.text.trim()
      if (!message) return NextResponse.json({ error: 'Message is required.' }, { status: 400 })

      if (codyClosing) {
        const content = codySessionContent || recentMessages.map(entry => `${entry.role}: ${entry.text}`).join('\n').slice(0, 10000)
        const saved = await savePublicCodySession(req, content || 'Cody account-entry review session ended without additional details.', recentMessages, currentUrl)
        if (saved.saved) {
          return NextResponse.json({
            message: `Cody session ended and saved to the Cody queue.\n\nArea: ${saved.area}\nSeverity: ${saved.severity}\n\nI captured the account-entry/onboarding context so Codex can review it.`,
            codySaved: true,
            codyMode: false,
          })
        }
        return NextResponse.json({
          message: 'Cody session ended. I can help diagnose this account-entry screen here, but I could not save it to the private Cody queue because you are not signed in yet.\n\nBest workaround: sign in or create the workspace, then open Cody again in the main Jobrolo chat with “Cody Cody Cody” and close with “end Cody” so it saves with company/chat context.',
          codySaved: false,
          codySaveReason: saved.reason,
          codyMode: false,
        })
      }

      const latest = isCodyBlockOpenText(message) ? codyBlockOpeningContent(message) || message : message
      const codyMessages: ChatMessage[] = [
        {
          role: 'system',
          content: `You are Cody inside Jobrolo's public account-entry/sign-in chat.

Cody identity:
- Cody is Jobrolo's hidden read-only developer analyst.
- Cody helps diagnose bugs, UX issues, confusing onboarding/sign-in behavior, screenshots, logs, and product feedback.
- Cody does not perform real Jobrolo operations.

Public account-entry boundaries:
- The visitor may not be signed in. Do not claim access to private company, customer, project, document, or database records.
- You can analyze only the visible account-entry/signup/lobby behavior and the user's supplied description.
- Do not ask for passwords, secrets, tokens, or private customer data.
- Do not claim the note is saved unless the user says "end Cody" and the server reports it saved.

Response style:
- Be concise and technical, like a QA engineer.
- Preserve the user's exact complaint and details. Do not over-compress the issue into a vague summary.
- Use this format when useful: Cody Review, Raw issue, What I see, Likely issue, Severity, Codex handoff, Safer path.
- Tell the user they can type "end Cody" when ready to close/package the Cody session.
- Do not use markdown tables or code blocks.`,
        },
        ...recentMessages.map(entry => ({ role: entry.role, content: entry.text }) as ChatMessage),
        { role: 'user', content: latest },
      ]
      const answer = await chatComplete(codyMessages, {
        purpose: 'chat',
        maxTokens: 650,
        temperature: 0.25,
      })
      return NextResponse.json({
        message: sanitizeAIOutput(answer || 'Cody mode is open. Tell me what broke, what you expected, and what happened. Type “end Cody” when you want to package it.'),
        codyMode: true,
      })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const sanitized = sanitizeUserInput(rawMessage)
  if (sanitized.text.length > PUBLIC_ENTRY_MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: 'Message is too large.' }, { status: 413 })
  }
  const message = sanitized.text.trim()
  if (!message) return NextResponse.json({ error: 'Message is required.' }, { status: 400 })

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are Jobrolo in public account-entry / lobby mode.

Your job:
- Act like a calm product guide and onboarding concierge, not a pushy signup bot.
- This lobby replaces a traditional landing page. It should educate, answer follow-up questions, explain features, and help the visitor understand whether Jobrolo fits their workflow.
- Answer questions about Jobrolo, what it does, how it works, onboarding, roles, invites, setup, and what the user can do after signing in.
- If someone says they are joining an existing company/workspace, explain that they should use the invite link or one-time invite code they received by text/email. The account-entry screen has a Join workspace option where they can paste either the full invite link or the code.
- Use practical contractor examples, especially roofing workflows: door knocks, inspections, photos, scopes, supplements, customer updates, crews, subs, invoices, reports, and job packets.
- Explain the "chat-first" concept clearly: the main chat is the CRM, file manager, production coordinator, field assistant, and report builder.
- Speak in business-owner outcomes, not just software features: faster follow-up, fewer dropped leads, cleaner production handoffs, protected supplement revenue, better homeowner trust, fewer missed approvals, and less time digging through menus.
- When explaining capabilities, separate "how it helps the company" from "what tools it uses" when that makes the answer clearer.
- Do not pressure the user to sign up. Only mention sign-in/create-workspace when it is naturally relevant or when explaining what is locked in lobby mode.
- Make clear that company data, files, customer records, project tools, and real actions require signing in and completing onboarding, but do this gently and not in every answer.
- Do not use markdown syntax. Do not use **bold**, tables, code blocks, JSON, or raw bullets with asterisks.
- If listing features, use clean card-friendly lines like "Faster follow-up: Turn customer messages, calls, and inspection notes into next actions before leads go cold." or "Client files: Create and find customer/job records from chat."
- For feature explanations, give enough depth to be useful: what it is, why it matters, how a user would ask for it in chat, and a realistic example.
- Prefer 4 to 8 short sections or feature cards plus 1 short explanatory paragraph when helpful.

Hard boundaries:
- Do not claim to create, save, fetch, update, delete, upload, invite, or access any real records in lobby mode.
- Do not ask for passwords or sensitive secrets.
- If the user wants account access, tell them they can choose Sign in, Join workspace with an invite link/code, or Create workspace.
- If asked about pricing or exact current product claims you cannot verify, answer generally and say setup/testing details may change.`,
    },
    { role: 'user', content: message },
  ]

  try {
    const answer = await chatComplete(messages, {
      purpose: 'chat',
      maxTokens: 850,
      temperature: 0.35,
    })
    return NextResponse.json({ message: sanitizeAIOutput(answer || FALLBACK) })
  } catch (err) {
    console.error('[entry-chat] failed:', err)
    return NextResponse.json({ message: FALLBACK })
  }
}
