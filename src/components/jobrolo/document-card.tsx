'use client'
import { useState } from 'react'
import { Loader2, CheckCircle2, FileText, AlertCircle, Download, ScanLine } from 'lucide-react'
import { cn, formatFileSize } from '@/lib/utils'
import type { MessageAttachment } from '@/lib/types'

const FILE_TYPE_LABELS: Record<string, string> = {
  scope_of_loss: 'Scope of Loss',
  price_sheet: 'Price Sheet',
  estimate: 'Estimate',
  contract: 'Contract',
  insurance_claim: 'Insurance Claim',
  invoice: 'Invoice',
  pdf: 'PDF',
  photo: 'Photo',
  other: 'Document',
}

export function DocumentCard({ attachment }: { attachment: MessageAttachment }) {
  const [expanded, setExpanded] = useState(false)
  const status = attachment.documentStatus
  const isQueued = status === 'queued'
  const isProcessing = status === 'processing'
  const isFailed = status === 'failed'
  const isNeedsOcr = status === 'needs_ocr'
  const isReady = status === 'reviewed' || (!status && !!attachment.url)
  const typeLabel = FILE_TYPE_LABELS[attachment.documentType ?? ''] ?? 'Document'

  const extracted = attachment.documentExtractedData as Record<string, unknown> | null | undefined
  const materialItems = (extracted?.materialItems as unknown[]) || []
  const lineItems = (extracted?.lineItems as unknown[]) || []
  const claimInfo = extracted?.claimInfo as Record<string, unknown> | undefined
  const itemCount = materialItems.length || lineItems.length
  const hasExtractedData = !!(extracted && Object.keys(extracted).length > 0)

  // Collaborative extraction fields (v3)
  const confidence = extracted?.extractionConfidence as number | undefined
  const conflicts = (extracted?.conflicts as Record<string, boolean> | undefined) ?? {}
  const conflictCount = Object.values(conflicts).filter(Boolean).length
  const missingData = (extracted?.missingData as Record<string, boolean> | undefined) ?? {}
  const missingCount = Object.values(missingData).filter(Boolean).length
  const reviewNotes = (extracted?.reviewNotes as string[] | undefined) ?? []
  const warnings = (extracted?.warnings as string[] | undefined) ?? []
  const hasReviewNotes = reviewNotes.length > 0 || warnings.length > 0

  // Status icon
  const StatusIcon = isQueued || isProcessing
    ? <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
    : isFailed
      ? <AlertCircle className="w-4 h-4 text-rose-500" />
      : isNeedsOcr
        ? <ScanLine className="w-4 h-4 text-orange-500" />
        : isReady
          ? <CheckCircle2 className="w-4 h-4 text-blue-500" />
          : <FileText className="w-4 h-4 text-slate-400" />

  // Status badge text
  let statusBadge: string | null = null
  if (isQueued) statusBadge = '· Queued…'
  else if (isProcessing) statusBadge = '· Analyzing…'
  else if (isNeedsOcr) statusBadge = '· Needs OCR'
  else if (isReady && itemCount > 0) statusBadge = `· ${itemCount} items extracted`

  const statusBadgeColor = isNeedsOcr ? 'text-orange-700' : isReady && itemCount > 0 ? 'text-blue-700' : isFailed ? 'text-rose-600' : 'text-amber-600'

  // Confidence color: green >=70, yellow 40-69, red <40
  const confidenceColor = confidence == null ? '' : confidence >= 70 ? 'text-blue-700' : confidence >= 40 ? 'text-amber-700' : 'text-rose-700'
  const confidenceLabel = confidence == null ? null : `${confidence}%`

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 overflow-hidden w-full sm:max-w-md">
      <div
        onClick={() => isReady && hasExtractedData && setExpanded(v => !v)}
        className={cn(
          'w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors',
          isReady && hasExtractedData && 'hover:bg-slate-100 cursor-pointer',
          (!isReady || !hasExtractedData) && 'cursor-default',
        )}
      >
        <div className="flex-shrink-0 w-9 h-9 rounded-md bg-white border border-slate-200 flex items-center justify-center">
          {StatusIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-slate-800 truncate">{attachment.name}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{typeLabel}</span>
            {attachment.size !== undefined && (
              <>
                <span className="text-[10px] text-slate-400">·</span>
                <span className="text-[10px] text-slate-400">{formatFileSize(attachment.size)}</span>
              </>
            )}
            {statusBadge && <span className={cn('text-[10px] font-medium', statusBadgeColor)}>{statusBadge}</span>}
            {confidenceLabel && isReady && (
              <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', confidenceColor, 'bg-slate-100')}>
                conf {confidenceLabel}
              </span>
            )}
            {conflictCount > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded text-rose-700 bg-rose-50" title={Object.keys(conflicts).filter(k => conflicts[k]).join(', ')}>
                ⚠ {conflictCount} conflict{conflictCount > 1 ? 's' : ''}
              </span>
            )}
            {missingCount > 0 && isReady && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded text-amber-700 bg-amber-50" title={Object.keys(missingData).filter(k => missingData[k]).join(', ')}>
                {missingCount} missing field{missingCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {attachment.documentSummary && (
            <div className="text-xs text-slate-600 mt-1.5 line-clamp-2">{attachment.documentSummary}</div>
          )}
        </div>
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 p-1.5 rounded-md hover:bg-slate-200 text-slate-500"
          aria-label="Open file"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>
      {expanded && isReady && extracted && (
        <div className="border-t border-slate-200 bg-white px-3 py-3 space-y-3">
          {claimInfo && Object.keys(claimInfo).length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1.5">Claim Info</div>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                {claimInfo.insured ? <><dt className="text-[10px] text-slate-500 uppercase">Insured</dt><dd className="text-slate-800 font-medium">{String(claimInfo.insured)}</dd></> : null}
                {claimInfo.property ? <><dt className="text-[10px] text-slate-500 uppercase">Property</dt><dd className="text-slate-800 font-medium">{String(claimInfo.property)}</dd></> : null}
                {claimInfo.claimNumber ? <><dt className="text-[10px] text-slate-500 uppercase">Claim #</dt><dd className="text-slate-800 font-medium">{String(claimInfo.claimNumber)}</dd></> : null}
                {claimInfo.total !== undefined ? <><dt className="text-[10px] text-slate-500 uppercase">Total</dt><dd className="text-slate-800 font-medium">${String(claimInfo.total)}</dd></> : null}
              </dl>
            </div>
          )}
          {lineItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1.5">Line Items ({lineItems.length})</div>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="px-1 py-1 font-medium">Description</th>
                      <th className="px-1 py-1 font-medium text-right">Qty</th>
                      <th className="px-1 py-1 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.slice(0, 15).map((item, i) => {
                      const li = item as any
                      return (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="px-1 py-1"><div className="font-medium text-slate-800">{li.description || '—'}</div></td>
                          <td className="px-1 py-1 text-right text-slate-600">{li.quantity ?? '—'} {li.unit || ''}</td>
                          <td className="px-1 py-1 text-right font-medium text-slate-800">{li.total ? `$${li.total}` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {materialItems.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1.5">Material Items ({materialItems.length})</div>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="px-1 py-1 font-medium">Item</th>
                      <th className="px-1 py-1 font-medium text-right">Unit</th>
                      <th className="px-1 py-1 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialItems.slice(0, 15).map((item, i) => {
                      const mi = item as any
                      return (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="px-1 py-1"><div className="font-medium text-slate-800">{mi.name || '—'}</div>{mi.sku && <div className="text-[10px] text-slate-400">{mi.sku}</div>}</td>
                          <td className="px-1 py-1 text-right text-slate-600">{mi.unit || 'EA'}</td>
                          <td className="px-1 py-1 text-right font-medium text-slate-800">${mi.unitCost ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Collaborative extraction: review notes + warnings */}
          {hasReviewNotes && (
            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-700 mb-1.5">AI Review Notes</div>
              <ul className="space-y-1">
                {warnings.map((w, i) => (
                  <li key={`w-${i}`} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <span className="text-amber-500 mt-0.5">⚠</span>
                    <span>{w.replace(/^⚠️\s*/, '')}</span>
                  </li>
                ))}
                {reviewNotes.slice(0, 8).map((note, i) => (
                  <li key={`n-${i}`} className="text-xs text-slate-600 flex items-start gap-1.5">
                    <span className="text-slate-400 mt-0.5">•</span>
                    <span>{note}</span>
                  </li>
                ))}
                {reviewNotes.length > 8 && (
                  <li className="text-xs text-slate-400 italic">+ {reviewNotes.length - 8} more notes</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
