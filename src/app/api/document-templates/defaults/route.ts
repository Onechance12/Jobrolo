import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { DEFAULT_DOCUMENT_TEMPLATES } from '@/lib/document-templates/presets'

export async function POST(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })

  const created: any[] = []
  for (const template of DEFAULT_DOCUMENT_TEMPLATES) {
    const existing = await db.documentTemplate.findFirst({
      where: { contractorId: ctx.contractorId, type: template.type, name: template.name, status: 'active' },
    })
    if (existing) continue
    created.push(await db.documentTemplate.create({
      data: {
        contractorId: ctx.contractorId,
        name: template.name,
        type: template.type,
        bodyHtml: template.bodyHtml,
        variablesJson: JSON.stringify(template.variables),
        requiresSignature: template.requiresSignature,
      },
    }))
  }

  return NextResponse.json({ createdCount: created.length, templates: created })
}
