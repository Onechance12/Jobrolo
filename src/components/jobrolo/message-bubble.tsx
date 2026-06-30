'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { User, Loader2, FileText, ChevronLeft, ChevronRight, X, Zap, CheckCircle2, XCircle, Circle, Volume2, Square, Brain, ExternalLink } from 'lucide-react'
import { cn, formatMessageTime, formatFileSize, stripJsonWrapper } from '@/lib/utils'
import { getChannelConfig } from '@/lib/channels'
import { getJobroloCardSpeechSummary, isStructuredJobroloCardType } from '@/lib/cards/templates'
import { DocumentCard } from './document-card'
import { CopilotCardFromMessage } from './copilot-cards'
import type { ClientMessage, MessageAttachment, ActionResult, ThinkingStep } from '@/lib/types'

interface Props { message: ClientMessage; isStreaming?: boolean; onSpeak?: (text: string) => void; isSpeaking?: boolean; userAvatar?: string | null }

function JobroloAvatar({ className }: { className?: string }) {
  return (
    <div className={cn('flex-shrink-0 w-8 h-8 overflow-hidden rounded-full bg-slate-950 shadow-[0_0_18px_rgba(37,99,235,0.45)] ring-1 ring-blue-400/30', className)}>
      <img src="/logo-512.png" alt="Jobrolo" className="h-full w-full object-cover" />
    </div>
  )
}

export function MessageBubble({ message, onSpeak, isSpeaking, userAvatar }: Props) {
  const isUser = message.role === 'user'
  const content = isUser ? message.content : stripJsonWrapper(message.content)
  const cardType = String((message.contextData as any)?.cardType || (message.contextData as any)?.type || message.contextType || '').toLowerCase()
  const preferStructuredCard = !isUser && isStructuredJobroloCardType(cardType)
  const visibleContent = preferStructuredCard ? getJobroloCardSpeechSummary(cardType) : content
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className={cn('flex w-full max-w-full min-w-0 gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 overflow-hidden', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {isUser ? (
        <div className="flex-shrink-0 w-8 h-8 overflow-hidden rounded-full flex items-center justify-center bg-muted text-muted-foreground">
          {userAvatar ? <img src={userAvatar} alt="Your profile" className="h-full w-full object-cover" /> : <User className="w-4 h-4" />}
        </div>
      ) : <JobroloAvatar />}
      <div className={cn('flex-1 min-w-0 max-w-[85%] sm:max-w-[80%] overflow-hidden', isUser && 'flex flex-col items-end')}>
        {!isUser && message.thinking && message.thinking.length > 0 && <ThinkingSteps steps={message.thinking} />}
        <div className={cn('rounded-2xl px-3.5 sm:px-4 py-2.5 text-[15px] leading-relaxed max-w-full overflow-hidden break-words [overflow-wrap:anywhere]', isUser ? 'bg-blue-600 text-white rounded-tr-md' : 'bg-card border border-border text-card-foreground rounded-tl-md')}>
          <FormattedContent content={visibleContent} />
        </div>
        {message.contextType && <CopilotCardFromMessage contextType={message.contextType} contextData={message.contextData ?? null} content={content} />}
        {message.attachments && message.attachments.length > 0 && <AttachmentGrid attachments={message.attachments} />}
        {message.actionResults && message.actionResults.length > 0 && <ActionResultsCard results={message.actionResults} />}
        {!isUser && (
          <div className="flex items-center gap-2 mt-1 px-1">
            {message.createdAt && <span className="text-[10px] text-muted-foreground/60">{formatMessageTime(message.createdAt)}</span>}
            {onSpeak && visibleContent && (
              <button onClick={() => onSpeak(visibleContent)} className={cn('flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full', isSpeaking ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : 'text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground')}>
                {isSpeaking ? <><Square className="w-2.5 h-2.5 fill-current" />Speaking…</> : <><Volume2 className="w-2.5 h-2.5" />Play</>}
              </button>
            )}
          </div>
        )}
        {isUser && message.createdAt && <div className="text-[10px] text-muted-foreground/60 mt-1 px-1 text-right">{formatMessageTime(message.createdAt)}</div>}
      </div>
    </motion.div>
  )
}

export function StreamingBubble({ text }: { text: string }) {
  // Show different loading states based on the text
  const isWorking = text && (
    text.toLowerCase().includes('search') ||
    text.toLowerCase().includes('check') ||
    text.toLowerCase().includes('look') ||
    text.toLowerCase().includes('review') ||
    text.toLowerCase().includes('analyz') ||
    text.toLowerCase().includes('process') ||
    text.toLowerCase().includes('get') ||
    text.toLowerCase().includes('pull') ||
    text.toLowerCase().includes('find')
  )

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex w-full max-w-full min-w-0 gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 overflow-hidden">
      <JobroloAvatar />
      <div className="flex-1 min-w-0 max-w-[85%] sm:max-w-[80%] overflow-hidden">
        <div className="rounded-2xl rounded-tl-md px-3.5 sm:px-4 py-2.5 bg-card border border-border text-card-foreground min-h-[40px] max-w-full overflow-hidden break-words [overflow-wrap:anywhere]">
          {text ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500 dark:text-blue-400 flex-shrink-0" />
              <FormattedContent content={text} />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Thinking…</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function FormattedContent({ content }: { content: string }) {
  if (!content) return null
  const normalized = content.replace(/!\[([^\]]*)\]\s*\n\s*\((https?:\/\/[^)\s]+)\)/g, '![$1]($2)')
  const lines = normalized.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  const flush = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`l-${elements.length}`} className="list-disc pl-5 my-1 space-y-0.5">{listItems.map((it, i) => <li key={i}>{renderInline(it)}</li>)}</ul>)
      listItems = []
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const table = parseMarkdownTable(lines, i)
    if (table) {
      flush()
      elements.push(<MarkdownTable key={`t-${i}`} headers={table.headers} rows={table.rows} />)
      i = table.endIndex
    } else if (/^\s*[-]\s+/.test(line)) {
      listItems.push(line.replace(/^\s*[-]\s+/, ''))
    } else if (/^\s*\d+\.\s+/.test(line)) {
      listItems.push(line.replace(/^\s*\d+\.\s+/, ''))
    } else if (line.trim() === '') {
      flush()
      elements.push(<div key={`s-${i}`} className="h-1.5" />)
    } else if (markdownImageFromLine(line)) {
      flush()
      const img = markdownImageFromLine(line)!
      elements.push(<MarkdownImage key={`img-${i}`} alt={img.alt} src={img.src} />)
    } else {
      flush()
      elements.push(<p key={`p-${i}`} className="my-0.5">{renderInline(line)}</p>)
    }
  }
  flush()
  return <div className="space-y-0.5 max-w-full break-words [overflow-wrap:anywhere]">{elements}</div>
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function parseMarkdownTable(lines: string[], startIndex: number): { headers: string[]; rows: string[][]; endIndex: number } | null {
  const header = lines[startIndex]
  const separator = lines[startIndex + 1]
  if (!header?.includes('|') || !separator?.includes('|')) return null
  if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator)) return null
  const headers = splitTableRow(header)
  if (headers.length < 2) return null
  const rows: string[][] = []
  let endIndex = startIndex + 1
  for (let i = startIndex + 2; i < lines.length; i++) {
    const row = lines[i]
    if (!row.includes('|') || !row.trim()) break
    rows.push(splitTableRow(row))
    endIndex = i
  }
  return rows.length ? { headers, rows, endIndex } : null
}

function MarkdownTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-2 max-w-full overflow-hidden rounded-xl border border-border bg-background/70">
      <div className="max-w-full overflow-x-auto">
        <table className="min-w-[640px] border-collapse text-left text-xs">
          <thead className="bg-muted/70 text-muted-foreground">
            <tr>
              {headers.map((header, index) => (
                <th key={index} className="whitespace-nowrap border-b border-border px-2.5 py-2 font-semibold">{renderInline(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border/60 last:border-b-0">
                {headers.map((_, cellIndex) => (
                  <td key={cellIndex} className="max-w-[18rem] px-2.5 py-2 align-top text-card-foreground">
                    <span className="line-clamp-3">{renderInline(row[cellIndex] ?? '')}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 4 ? (
        <div className="border-t border-border bg-muted/30 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          Swipe sideways to review columns. Ask Jobrolo for deductible pool, trade totals, or excluded items for a cleaner summary.
        </div>
      ) : null}
    </div>
  )
}

function markdownImageFromLine(line: string): { alt: string; src: string } | null {
  const match = line.trim().match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/)
  if (!match) return null
  return { alt: match[1] || 'Image', src: match[2] }
}

function MarkdownImage({ alt, src }: { alt: string; src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1 text-sm text-muted-foreground underline-offset-2 hover:underline">
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{alt || 'View image'}</span>
      </a>
    )
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="my-2 block max-w-[260px] overflow-hidden rounded-xl border border-border bg-muted/40">
      <img src={src} alt={alt} className="max-h-56 w-full object-contain" onError={() => setFailed(true)} />
    </a>
  )
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIdx = 0, match, key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index))
    const m = match[0]
    if (match[2] && match[3]) {
      parts.push(<a key={key++} href={match[3]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-blue-500">{match[2]}</a>)
    } else if (m.startsWith('http')) {
      parts.push(<a key={key++} href={m} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2 hover:text-blue-500">{m}</a>)
    } else if (m.startsWith('**')) parts.push(<strong key={key++}>{m.slice(2, -2)}</strong>)
    else parts.push(<em key={key++}>{m.slice(1, -1)}</em>)
    lastIdx = match.index + m.length
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return parts.length > 0 ? parts : text
}

function AttachmentGrid({ attachments }: { attachments: MessageAttachment[] }) {
  const images = attachments.filter(a => a.type === 'image')
  const links = attachments.filter(a => a.type === 'link')
  const files = attachments.filter(a => a.type !== 'image' && a.type !== 'link')
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [failed, setFailed] = useState<Set<string>>(new Set())
  return (
    <div className="mt-2 space-y-2 w-full max-w-full sm:max-w-md overflow-hidden">
      {images.length > 0 && (
        <div className={cn('grid gap-1.5', images.length === 1 ? 'grid-cols-1 max-w-[240px]' : 'grid-cols-2 sm:grid-cols-3')}>
          {images.map((img, i) => {
            const isFailed = failed.has(img.url)
            return (
              <button key={img.url + i} onClick={() => !isFailed && setLightboxIdx(i)} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted/50">
                {isFailed ? <div className="w-full h-full flex items-center justify-center text-muted-foreground/60"><FileText className="w-6 h-6" /></div> : <img src={img.thumbnailUrl || img.url} alt={img.name} className="w-full h-full object-cover" onError={() => setFailed(p => new Set(p).add(img.url))} />}
              </button>
            )
          })}
        </div>
      )}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => f.documentId ? <DocumentCard key={f.url + i} attachment={f} /> : <a key={f.url + i} href={f.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground hover:bg-muted min-h-[40px]"><FileText className="w-4 h-4 text-muted-foreground" /><span className="flex-1 truncate">{f.name}</span>{f.size && <span className="text-xs text-muted-foreground/60">{formatFileSize(f.size)}</span>}</a>)}
        </div>
      )}
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((link, i) => <SourcePreview key={link.url + i} attachment={link} />)}
        </div>
      )}
      {lightboxIdx !== null && images[lightboxIdx] && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={() => setLightboxIdx(null)}>
          <button className="absolute top-4 right-4 p-3 text-white/70 hover:text-white"><X className="w-6 h-6" /></button>
          {lightboxIdx > 0 && <button className="absolute left-4 p-3 text-white/70 hover:text-white" onClick={e => { e.stopPropagation(); setLightboxIdx(i => i! - 1) }}><ChevronLeft className="w-8 h-8" /></button>}
          {lightboxIdx < images.length - 1 && <button className="absolute right-4 p-3 text-white/70 hover:text-white" onClick={e => { e.stopPropagation(); setLightboxIdx(i => i! + 1) }}><ChevronRight className="w-8 h-8" /></button>}
          <img src={images[lightboxIdx].url} alt={images[lightboxIdx].name} className="max-w-[95vw] max-h-[95vh] object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

function SourcePreview({ attachment }: { attachment: MessageAttachment }) {
  let host = attachment.source
  try {
    host = host || new URL(attachment.url).hostname.replace(/^www\./, '')
  } catch {
    host = host || 'web source'
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border border-border bg-card/80 p-3 text-sm shadow-sm transition hover:border-blue-300 hover:bg-muted/40 dark:hover:border-blue-800"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-300">
          <ExternalLink className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{attachment.name || host}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{host}</div>
          {attachment.description ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{attachment.description}</p> : null}
        </div>
      </div>
    </a>
  )
}

function ActionResultsCard({ results }: { results: ActionResult[] }) {
  return (
    <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/50 overflow-hidden w-full sm:max-w-md">
      <div className="px-3 py-1.5 bg-blue-100/60 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-800 flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-300"><Zap className="w-3.5 h-3.5" />Routed</div>
      <ul className="px-3 py-2 space-y-1.5">{results.map((r, i) => <ActionRow key={i} result={r} />)}</ul>
    </div>
  )
}

function ActionRow({ result }: { result: ActionResult }) {
  const config = result.targetChatType ? getChannelConfig(result.targetChatType) : null
  const Icon = result.status === 'executed' ? CheckCircle2 : result.status === 'failed' ? XCircle : Circle
  const color = result.status === 'executed' ? 'text-blue-600 dark:text-blue-300' : result.status === 'failed' ? 'text-rose-600' : 'text-muted-foreground/60'
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', color)} />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-muted-foreground capitalize">{result.action.replace('_', ' ')}</span>
        {config && <span className={cn('ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium', config.bg, config.color)}>{config.label}</span>}
        <span className="text-muted-foreground ml-1">— {result.detail}</span>
      </div>
    </li>
  )
}

function ThinkingSteps({ steps }: { steps: ThinkingStep[] }) {
  const [expanded, setExpanded] = useState(false)
  const safeStepText = (text: string) => {
    if (/You said "|MUST call|Common recovery examples|Respond as JSON only|Tool results:|\[UPLOADED DOCUMENTS|UNTRUSTED_CONTENT|narrated operational work/i.test(text)) {
      return 'Checking the right saved workflow…'
    }
    return text.length > 140 ? `${text.slice(0, 137)}…` : text
  }
  const labelTool = (name: string) => name.replace(/_/g, ' ')
  return (
    <div className="mb-2 rounded-lg border border-border bg-muted/60 overflow-hidden w-full sm:max-w-md">
      <button onClick={() => setExpanded(v => !v)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
        <Brain className="w-3.5 h-3.5 text-violet-500" />
        <span>Activity ({steps.length})</span>
        <ChevronRight className={cn('w-3 h-3 ml-auto transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {steps.map((step, i) => (
            <div key={i} className="text-xs space-y-1 border-l-2 border-border pl-2.5">
              <div className="text-muted-foreground italic">{safeStepText(step.text)}</div>
              {step.toolCalls?.map((tc, j) => (
                <div key={j} className="flex items-start gap-1.5 text-muted-foreground">
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded capitalize">{labelTool(tc.name)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
