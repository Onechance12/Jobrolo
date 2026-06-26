'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { Paperclip, Camera, Send, X, Mic, Plus, FileText, Square } from 'lucide-react'
import { cn, formatFileSize, isImageFile } from '@/lib/utils'
import type { MessageAttachment } from '@/lib/types'

interface Props { onSend: (args: { text: string; attachments?: File[] }) => void; onStop?: () => void; disabled?: boolean; isWorking?: boolean; placeholder?: string }
const SUGGESTIONS = ['What am I forgetting?', "What's on my plate?", 'Show open jobs']

export function ChatInput({ onSend, onStop, disabled, isWorking, placeholder }: Props) {
  const [text, setText] = useState(''); const [pendingFiles, setPendingFiles] = useState<File[]>([]); const [showAttachMenu, setShowAttachMenu] = useState(false); const [listening, setListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null); const cameraInputRef = useRef<HTMLInputElement>(null); const textareaRef = useRef<HTMLTextAreaElement>(null); const recognitionRef = useRef<any>(null)
  const textRef = useRef(text); useEffect(() => { textRef.current = text }, [text])

  // Check speech support on client only — prevents hydration mismatch
  useEffect(() => {
    setSpeechSupported(!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition)
  }, [])

  useEffect(() => { const ta = textareaRef.current; if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px' }, [text])

  const handleSend = useCallback(() => { const t = text.trim(); if (!t && !pendingFiles.length) return; if (disabled) return; onSend({ text: t, attachments: pendingFiles }); setText(''); setPendingFiles([]) }, [text, pendingFiles, disabled, onSend])
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }
  const handleFiles = (files: FileList | null) => { if (!files) return; setPendingFiles(p => [...p, ...Array.from(files)]); setShowAttachMenu(false) }

  const startListening = () => { if (listening) { recognitionRef.current?.stop(); setListening(false); return } const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) return; const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'; let ft = textRef.current; rec.onresult = (e: any) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const tr = e.results[i][0].transcript; if (e.results[i].isFinal) ft += tr; else interim += tr } setText(ft); setInterimText(interim) }; rec.onend = () => setListening(false); rec.onerror = () => setListening(false); rec.start(); recognitionRef.current = rec; setListening(true) }
  const [interimText, setInterimText] = useState('')

  return (
    <div className="border-t border-border bg-card px-3 sm:px-4 pt-2.5 pb-2.5">
      {pendingFiles.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{pendingFiles.map((f, i) => <PendingFileChip key={i} file={f} onRemove={() => setPendingFiles(p => p.filter((_, idx) => idx !== i))} />)}</div>}
      {text === '' && !pendingFiles.length && !listening && <div className="mb-2 flex flex-wrap gap-1.5">{SUGGESTIONS.map(s => <button key={s} onClick={() => setText(s)} className="px-3 py-1.5 rounded-full text-xs bg-muted text-muted-foreground hover:bg-muted-foreground/20 min-h-[32px]">{s}</button>)}</div>}
      {listening && <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200"><span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" /></span><span className="text-sm text-rose-700 font-medium">Listening{interimText ? `: ${interimText}` : '…'}</span></div>}
      <div className="flex items-end gap-2">
        <div className="relative flex-shrink-0"><button onClick={() => setShowAttachMenu(v => !v)} disabled={disabled} className="p-2.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50 min-w-[44px] min-h-[44px] flex items-center justify-center"><Plus className="w-5 h-5" /></button>
          {showAttachMenu && (<><div className="fixed inset-0 z-10" onClick={() => setShowAttachMenu(false)} /><div className="absolute bottom-12 left-0 z-20 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[180px]"><button onClick={() => cameraInputRef.current?.click()} className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-foreground hover:bg-muted/50 min-h-[44px]"><Camera className="w-5 h-5 text-blue-600 dark:text-blue-300" /><span><div className="font-medium">Take photo</div><div className="text-[10px] text-muted-foreground/60">Field photos</div></span></button><button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-foreground hover:bg-muted/50 min-h-[44px]"><Paperclip className="w-5 h-5 text-muted-foreground" /><span><div className="font-medium">Attach file</div><div className="text-[10px] text-muted-foreground/60">PDFs, docs, images</div></span></button></div></>)}
        </div>
        <textarea ref={textareaRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={handleKeyDown} placeholder={placeholder ?? 'Message Jobrolo…'} rows={1} disabled={disabled} suppressHydrationWarning className="flex-1 resize-none bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-[16px] leading-6 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 focus:border-blue-400 dark:focus:border-blue-500 disabled:opacity-50 max-h-40 min-h-[44px]" />
        {isWorking && onStop ? (
          <button onClick={onStop} className="flex-shrink-0 rounded-lg bg-rose-600 text-white hover:bg-rose-700 min-w-[52px] min-h-[52px] flex items-center justify-center gap-1.5 px-3" aria-label="Stop Jobrolo">
            <Square className="w-4 h-4 fill-current" />
            <span className="hidden sm:inline text-sm font-medium">Stop</span>
          </button>
        ) : (
          <>
            {speechSupported && <button onClick={startListening} disabled={disabled} className={cn('flex-shrink-0 rounded-full transition-all min-w-[52px] min-h-[52px] flex items-center justify-center', listening ? 'bg-rose-500 text-white scale-110 shadow-lg shadow-rose-500/40' : 'bg-blue-600 text-white hover:bg-blue-700', disabled && 'opacity-50')} aria-label={listening ? 'Stop' : 'Hold to talk'}><Mic className="w-5 h-5" /></button>}
            {(text.trim() || pendingFiles.length > 0) && !listening && <button onClick={handleSend} disabled={disabled} className="flex-shrink-0 p-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 min-w-[44px] min-h-[44px] flex items-center justify-center"><Send className="w-4 h-4" /></button>}
          </>
        )}
      </div>
      <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv" className="hidden" onChange={e => handleFiles(e.target.files)} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFiles(e.target.files)} />
    </div>
  )
}

function PendingFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl] = useState<string | null>(() => {
    if (isImageFile(file.type)) return URL.createObjectURL(file)
    return null
  })
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  return (
    <div className="relative flex items-center gap-2 px-2 py-1.5 pr-7 rounded-md bg-muted border border-border">
      {previewUrl ? (
        <img src={previewUrl} alt={file.name} className="w-8 h-8 rounded object-cover" />
      ) : (
        <div className="w-8 h-8 rounded bg-card flex items-center justify-center">
          <FileText className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-xs font-medium text-foreground max-w-[120px] truncate">{file.name}</span>
        <span className="text-[10px] text-muted-foreground/60">{formatFileSize(file.size)}</span>
      </div>
      <button onClick={onRemove} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-foreground/15 text-foreground flex items-center justify-center hover:bg-foreground/25">
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  )
}
