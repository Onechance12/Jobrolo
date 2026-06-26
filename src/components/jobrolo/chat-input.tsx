'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Paperclip, Camera, Send, X, Mic, Plus, FileText, Square, Building2, Globe2, Users, Save, MapPin } from 'lucide-react'
import { cn, formatFileSize, isImageFile } from '@/lib/utils'
import type { MessageAttachment } from '@/lib/types'

type SendResult = { ok?: boolean; keepAttachments?: boolean } | void
interface Props { onSend: (args: { text: string; displayText?: string; attachments?: File[] }) => SendResult | Promise<SendResult>; onStop?: () => void; disabled?: boolean; isWorking?: boolean; placeholder?: string }
type Shortcut = { label: string; prompt: string }
const CUSTOM_SHORTCUTS_KEY = 'jobrolo:custom-command-shortcuts:v1'
const SUGGESTIONS: Shortcut[] = [
  { label: 'Needs attention', prompt: 'What needs attention?' },
  { label: 'Saved clients', prompt: 'Show saved clients.' },
  { label: 'Company info', prompt: 'Show my saved company profile.' },
  { label: 'Create job', prompt: 'Create a project/job for ' },
]
const QUICK_COMMANDS: Shortcut[] = [
  { label: 'Update company info', prompt: 'Update my company profile: company name, phone, email, website, and address are ' },
  { label: 'Research website', prompt: 'Research my company website and suggest updates to my company profile: ' },
  { label: 'Field', prompt: 'Help me in the field where I am right now. If I am at a job, brief me and help me log the visit. If I am not at a saved job, help me canvass from here.' },
  { label: 'Create client', prompt: 'Create a client named ' },
  { label: 'Create job', prompt: 'Create a project/job for ' },
  { label: 'Create crew chat', prompt: 'Create a crew chat for ' },
  { label: 'Create customer chat', prompt: 'Create a customer-facing chat for ' },
  { label: 'Invite to chat', prompt: 'Invite this person to the chat and give me a copyable link: name, email, phone, role are ' },
]

function shouldRequestBrowserLocation(prompt: string) {
  const t = prompt.toLowerCase().replace(/[’']/g, "'")
  const asksHere = /\b(where i'?m at|where i am|right here|use my location|my location|current location|near me|nearby|gps|where we are|where i'm standing|where i am standing|here right now)\b/i.test(t)
  const fieldIntent = /\b(canvass|canvassing|door|knock|street|field|lead|property|house|map|route|inspection|appointment|jobsite|job site|arrived|onsite|on site)\b/i.test(t)
  const liveFieldMoment = /\b(walking up|walk up|i'?m here|i arrived|arrived|just landed|landed (an? )?inspection|got (an? )?inspection|set (an? )?inspection|at the house|at the property|outside mowing)\b/i.test(t)
  return asksHere || liveFieldMoment || (fieldIntent && /\b(here|right now|current|nearby|near me|gps|location|where i am|where i'm at)\b/i.test(t))
}

function browserLocationErrorMessage(err: unknown) {
  const code = typeof err === 'object' && err && 'code' in err ? Number((err as GeolocationPositionError).code) : null
  if (code === 1) return 'Location permission was denied. Tap send again and allow location, or send a nearby street/landmark.'
  if (code === 2) return 'Your browser could not determine location. Try again outside/with location services on, or send a nearby street/landmark.'
  if (code === 3) return 'Location request timed out. Try again, or send a nearby street/landmark.'
  return 'GPS is not available in this browser. Send a nearby street/landmark instead.'
}

function getBrowserLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('GPS unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 30_000,
    })
  })
}

function appendBrowserLocation(prompt: string, pos: GeolocationPosition) {
  const { latitude, longitude, accuracy } = pos.coords
  return `${prompt}

[BROWSER_LOCATION]
latitude: ${latitude}
longitude: ${longitude}
accuracyMeters: ${Math.round(accuracy)}
source: browser_gps
capturedAt: ${new Date().toISOString()}
Use this location for the user's "where I am / here / near me" request. Do not ask the user to type GPS coordinates again unless you need a street name or landmark for a specific tool.`
}

export function ChatInput({ onSend, onStop, disabled, isWorking, placeholder }: Props) {
  const [text, setText] = useState(''); const [pendingFiles, setPendingFiles] = useState<File[]>([]); const [showAttachMenu, setShowAttachMenu] = useState(false); const [listening, setListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [customShortcuts, setCustomShortcuts] = useState<Shortcut[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null); const cameraInputRef = useRef<HTMLInputElement>(null); const textareaRef = useRef<HTMLTextAreaElement>(null); const recognitionRef = useRef<any>(null)
  const textRef = useRef(text); useEffect(() => { textRef.current = text }, [text])

  // Check speech support on client only — prevents hydration mismatch
  useEffect(() => {
    setSpeechSupported(!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition)
  }, [])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_SHORTCUTS_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) {
        setCustomShortcuts(parsed.filter((item: any) => item?.label && item?.prompt).slice(0, 12))
      }
    } catch {}
  }, [])

  useEffect(() => {
    const onInsertPrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail
      if (detail?.text) {
        setText(detail.text)
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    }
    window.addEventListener('jobrolo:insert-prompt', onInsertPrompt)
    return () => window.removeEventListener('jobrolo:insert-prompt', onInsertPrompt)
  }, [])

  useEffect(() => { const ta = textareaRef.current; if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px' }, [text])

  const handleSend = useCallback(async () => {
    const t = text.trim()
    if (!t && !pendingFiles.length) return
    if (disabled || submitting) return
    setLocalError(null)
    setSubmitting(true)
    const filesToSend = [...pendingFiles]
    try {
      let finalText = t
      if (t && shouldRequestBrowserLocation(t)) {
        setLocalError('Requesting your location… allow it in the browser popup so Jobrolo can use where you are right now.')
        try {
          const position = await getBrowserLocation()
          finalText = appendBrowserLocation(t, position)
          setLocalError(null)
        } catch (err) {
          setLocalError(browserLocationErrorMessage(err))
          return
        }
      }
      const result = await onSend({ text: finalText, displayText: t, attachments: filesToSend })
      if (result && typeof result === 'object' && result.keepAttachments) {
        setLocalError('Upload did not finish. I kept the file attached so you can try again.')
        return
      }
      setText('')
      setPendingFiles([])
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Upload did not finish. I kept the file attached so you can try again.')
    } finally {
      setSubmitting(false)
    }
  }, [text, pendingFiles, disabled, submitting, onSend])
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }
  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const selected = Array.from(files).filter(file => file.size > 0)
    if (!selected.length) return
    console.log('[chat-input] files selected:', selected.map(file => ({ name: file.name, size: file.size, type: file.type || 'unknown' })))
    setLocalError(null)
    setPendingFiles(p => [...p, ...selected])
    setShowAttachMenu(false)
    window.setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }, 0)
  }
  const insertPrompt = (prompt: string) => {
    setText(prompt)
    setShowAttachMenu(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const saveCurrentPromptAsShortcut = () => {
    const prompt = text.trim()
    if (!prompt) return
    const label = prompt.length > 34 ? `${prompt.slice(0, 31)}…` : prompt
    const next = [{ label, prompt }, ...customShortcuts.filter(s => s.prompt !== prompt)].slice(0, 12)
    setCustomShortcuts(next)
    try { window.localStorage.setItem(CUSTOM_SHORTCUTS_KEY, JSON.stringify(next)) } catch {}
    setShowAttachMenu(false)
    setLocalError('Saved this prompt as a shortcut on this device.')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const deleteCustomShortcut = (prompt: string) => {
    const next = customShortcuts.filter(s => s.prompt !== prompt)
    setCustomShortcuts(next)
    try { window.localStorage.setItem(CUSTOM_SHORTCUTS_KEY, JSON.stringify(next)) } catch {}
  }

  const startListening = () => { if (listening) { recognitionRef.current?.stop(); setListening(false); return } const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) return; const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'; let ft = textRef.current; rec.onresult = (e: any) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const tr = e.results[i][0].transcript; if (e.results[i].isFinal) ft += tr; else interim += tr } setText(ft); setInterimText(interim) }; rec.onend = () => setListening(false); rec.onerror = () => setListening(false); rec.start(); recognitionRef.current = rec; setListening(true) }
  const [interimText, setInterimText] = useState('')

  return (
    <div className="border-t border-border bg-card px-3 sm:px-4 pt-2.5 pb-2.5">
      {pendingFiles.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{pendingFiles.map((f, i) => <PendingFileChip key={i} file={f} onRemove={() => setPendingFiles(p => p.filter((_, idx) => idx !== i))} />)}</div>}
      {localError ? <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">{localError}</div> : null}
      {text === '' && !pendingFiles.length && !listening && <div className="mb-2 flex flex-wrap gap-1.5">{[...customShortcuts.slice(0, 2), ...SUGGESTIONS].slice(0, 6).map(s => <button key={s.prompt} onClick={() => setText(s.prompt)} className="px-3 py-1.5 rounded-full text-xs bg-muted text-muted-foreground hover:bg-muted-foreground/20 min-h-[32px]">{s.label}</button>)}</div>}
      {listening && <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900/60 dark:bg-blue-950/30"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" /></span><span className="text-sm font-medium text-blue-800 dark:text-blue-100">Listening{interimText ? `: ${interimText}` : '…'}</span></div>}
      <div className="flex items-end gap-2">
        <div className="relative flex-shrink-0"><button onClick={() => setShowAttachMenu(v => !v)} disabled={disabled || submitting} className="p-2.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50 min-w-[44px] min-h-[44px] flex items-center justify-center"><Plus className="w-5 h-5" /></button>
          {showAttachMenu && (<><div className="fixed inset-0 z-10" onClick={() => setShowAttachMenu(false)} /><div className="absolute bottom-12 left-0 z-20 max-h-[70vh] min-w-[260px] overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg">
            <MenuButton icon={<Camera className="w-5 h-5 text-blue-600 dark:text-blue-300" />} label="Take photo" hint="Save field photos" onClick={() => cameraInputRef.current?.click()} />
            <MenuButton icon={<Paperclip className="w-5 h-5 text-muted-foreground" />} label="Attach file" hint="PDFs, docs, images" onClick={() => fileInputRef.current?.click()} />
            <div className="my-1 border-t border-border" />
            {QUICK_COMMANDS.map((cmd) => (
              <MenuButton
                key={cmd.prompt}
                icon={cmd.label.includes('Field') ? <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-300" /> : cmd.label.includes('company') ? <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-300" /> : cmd.label.includes('website') ? <Globe2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300" /> : cmd.label.includes('chat') || cmd.label.includes('Invite') ? <Users className="w-5 h-5 text-violet-600 dark:text-violet-300" /> : <FileText className="w-5 h-5 text-blue-600 dark:text-blue-300" />}
                label={cmd.label}
                hint="Insert editable prompt"
                onClick={() => insertPrompt(cmd.prompt)}
              />
            ))}
            {text.trim() ? (
              <>
                <div className="my-1 border-t border-border" />
                <MenuButton icon={<Save className="w-5 h-5 text-amber-600 dark:text-amber-300" />} label="Save typed prompt" hint="Add to your shortcuts" onClick={saveCurrentPromptAsShortcut} />
              </>
            ) : null}
            {customShortcuts.length > 0 ? (
              <>
                <div className="my-1 border-t border-border" />
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">My shortcuts</div>
                {customShortcuts.map((cmd) => (
                  <div key={cmd.prompt} className="group flex items-center">
                    <button onClick={() => insertPrompt(cmd.prompt)} className="flex min-h-[40px] flex-1 items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50">
                      <Save className="w-4 h-4 text-muted-foreground" />
                      <span className="truncate">{cmd.label}</span>
                    </button>
                    <button onClick={() => deleteCustomShortcut(cmd.prompt)} className="mr-1 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Delete shortcut ${cmd.label}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </>
            ) : null}
          </div></>)}
        </div>
        <textarea ref={textareaRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={handleKeyDown} placeholder={placeholder ?? 'Message Jobrolo…'} rows={1} disabled={disabled || submitting} suppressHydrationWarning className="flex-1 resize-none bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-[16px] leading-6 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 focus:border-blue-400 dark:focus:border-blue-500 disabled:opacity-50 max-h-40 min-h-[44px]" />
        {isWorking && onStop ? (
          <button onClick={onStop} className="flex-shrink-0 rounded-lg bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white min-w-[52px] sm:min-w-[72px] min-h-[52px] flex items-center justify-center gap-1.5 px-3 shadow-sm" aria-label="Stop Jobrolo">
            <Square className="w-4 h-4 fill-current" />
            <span className="hidden text-sm font-medium sm:inline">Stop</span>
          </button>
        ) : (
          <>
            {speechSupported && <button onClick={startListening} disabled={disabled || submitting} className={cn('flex-shrink-0 rounded-full transition-all min-w-[52px] min-h-[52px] flex items-center justify-center', listening ? 'bg-slate-800 text-white shadow-lg dark:bg-slate-100 dark:text-slate-950' : 'bg-blue-600 text-white hover:bg-blue-700', (disabled || submitting) && 'opacity-50')} aria-label={listening ? 'Stop voice input' : 'Start voice input'}><Mic className="w-5 h-5" /></button>}
            {(text.trim() || pendingFiles.length > 0) && !listening && <button onClick={handleSend} disabled={disabled || submitting} className="flex-shrink-0 p-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 min-w-[44px] min-h-[44px] flex items-center justify-center"><Send className="w-4 h-4" /></button>}
          </>
        )}
      </div>
      <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv" className="hidden" onChange={e => handleFiles(e.target.files)} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFiles(e.target.files)} />
    </div>
  )
}

function MenuButton({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-3 text-left text-sm text-foreground hover:bg-muted/50">
      {icon}
      <span>
        <div className="font-medium">{label}</div>
        <div className="text-[10px] text-muted-foreground/60">{hint}</div>
      </span>
    </button>
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
