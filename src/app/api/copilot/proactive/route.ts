import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/security/context'
import { createProactiveMessages } from '@/lib/copilot-proactive'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const url = new URL(req.url)
  const body = await req.json().catch(() => ({}))
  const result = await createProactiveMessages(ctx, {
    conversationId: body.conversationId ?? url.searchParams.get('conversationId'),
    workspaceId: body.workspaceId ?? url.searchParams.get('workspaceId'),
    chatId: body.chatId ?? url.searchParams.get('chatId'),
    projectId: body.projectId ?? url.searchParams.get('projectId'),
    reason: body.reason ?? url.searchParams.get('reason') ?? 'app_open',
    force: body.force === true || url.searchParams.get('force') === '1',
  })

  return NextResponse.json(result)
}
