import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireContext } from '@/lib/security/context'
import { requireAnyRoleResponse } from '@/lib/security/permissions'
import { getStorageConfig } from '@/lib/storage'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const ctx = await requireContext(req).catch(e => e)
  if (ctx instanceof Error) return NextResponse.json({ error: ctx.message }, { status: 401 })
  const roleErr = requireAnyRoleResponse(ctx, ['owner', 'admin', 'manager'])
  if (roleErr) return roleErr

  const [totals, byType, lastUpload, thumbnails] = await Promise.all([
    db.document.aggregate({
      where: { contractorId: ctx.contractorId },
      _count: { _all: true },
      _sum: { size: true },
    }),
    db.document.groupBy({
      by: ['fileType'],
      where: { contractorId: ctx.contractorId },
      _count: { _all: true },
      _sum: { size: true },
    }),
    db.document.findFirst({
      where: { contractorId: ctx.contractorId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, originalName: true, size: true, fileType: true, createdAt: true },
    }),
    db.document.count({ where: { contractorId: ctx.contractorId, thumbnailPath: { not: null } } }),
  ])

  const bytes = totals._sum.size ?? 0
  return NextResponse.json({
    provider: getStorageConfig().provider,
    totalBytes: bytes,
    totalGb: Number((bytes / 1024 / 1024 / 1024).toFixed(4)),
    documentCount: totals._count._all,
    thumbnailCount: thumbnails,
    counts: {
      photos: byType.find(r => r.fileType === 'photo')?._count._all ?? 0,
      pdfs: byType.filter(r => ['pdf', 'estimate', 'scope_of_loss', 'price_sheet', 'contract', 'invoice', 'insurance_claim', 'permit'].includes(r.fileType)).reduce((sum, r) => sum + r._count._all, 0),
    },
    byFileType: byType.map(row => ({
      fileType: row.fileType,
      count: row._count._all,
      bytes: row._sum.size ?? 0,
    })),
    lastUpload,
    timestamp: new Date().toISOString(),
  })
}
