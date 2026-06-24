import { readStoredFile } from '@/lib/storage'
import path from 'node:path'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { renderRoofReportHtml } from '@/lib/field-ops'
import { getContractorProfile } from '@/lib/contractor-profile'

function mimeFor(filename: string) {
  const ext = path.extname(filename).toLowerCase()
  if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'application/octet-stream'
}

async function embedReportImages(report: any) {
  const documentIds = (report.photos || []).map((p: any) => p.documentId).filter(Boolean)
  const docs = documentIds.length ? await db.document.findMany({ where: { contractorId: report.contractorId, id: { in: documentIds } }, select: { id: true, filePath: true, filename: true } }) : []
  const docMap = new Map<string, any>(docs.map((d: any) => [d.id, d]))
  const photos: any[] = []
  for (const photo of report.photos || []) {
    let imageUrl = photo.imageUrl
    const doc = photo.documentId ? docMap.get(photo.documentId) : null
    if (doc?.filePath) {
      try {
        const buf = await readStoredFile(doc.filePath)
        imageUrl = `data:${mimeFor(doc.filename)};base64,${buf.toString('base64')}`
      } catch {}
    }
    photos.push({ ...photo, imageUrl })
  }
  return { ...report, photos }
}

export default async function SharedRoofReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const report = await db.roofReport.findFirst({
    where: { shareToken: token, status: { in: ['shared', 'finalized'] } },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!report) notFound()
  const profile = await getContractorProfile(report.contractorId)
  const embedded = await embedReportImages(report)
  return <iframe title="Roof Report" srcDoc={renderRoofReportHtml(embedded, profile)} className="min-h-screen w-full border-0" />
}
