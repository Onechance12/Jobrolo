import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { checkBodySize } from '@/lib/security/body-size'
import { requireAnyRoleResponse } from '@/lib/security/permissions'
import { sanitizeHtml } from '@/lib/security/html'

const TemplateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().default('work_authorization'),
  status: z.string().default('active'),
  bodyHtml: z.string().min(1),
  variables: z.array(z.string()).optional(),
  requiresSignature: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? undefined
  const status = searchParams.get('status') ?? 'active'
  const reviewStatus = searchParams.get('reviewStatus') ?? undefined
  const importedOnly = searchParams.get('imported') === '1' || searchParams.get('imported') === 'true'
  const needsReviewOnly = searchParams.get('needsReview') === '1' || searchParams.get('needsReview') === 'true'

  const templates = await db.documentTemplate.findMany({
    where: {
      contractorId: ctx.contractorId,
      ...(status && status !== 'all' ? { status } : {}),
      ...(type ? { type } : {}),
      ...(reviewStatus ? { reviewStatus } : {}),
      ...(importedOnly ? { importedFromUpload: true } : {}),
      ...(needsReviewOnly ? { reviewStatus: { in: ['needs_review', 'parsed', 'uploaded'] } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ templates })
}

export async function POST(req: NextRequest) {
  const sizeErr = checkBodySize(req)
  if (sizeErr) return sizeErr
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager', 'project_manager', 'coordinator'])
  if (roleErr) return roleErr
  const parsed = TemplateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  const template = await db.documentTemplate.create({
    data: {
      contractorId: ctx.contractorId,
      name: input.name,
      type: input.type,
      status: input.status,
      bodyHtml: sanitizeHtml(input.bodyHtml),
      variablesJson: input.variables ? JSON.stringify(input.variables) : undefined,
      requiresSignature: input.requiresSignature,
    },
  })
  return NextResponse.json({ template }, { status: 201 })
}
