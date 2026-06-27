'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Paperclip, Camera, Send, X, Mic, Plus, FileText, Square } from 'lucide-react'
import { cn, formatFileSize, isImageFile } from '@/lib/utils'
import type { MessageAttachment } from '@/lib/types'
import {
  COMMAND_SHORTCUTS_KEY,
  COMMAND_SHORTCUTS_UPDATED_EVENT,
  DEFAULT_COMMAND_SHORTCUTS,
  LEGACY_CUSTOM_SHORTCUTS_KEY,
  makeCommandShortcut,
  parseStoredCommandShortcuts,
  type CommandShortcut,
} from '@/lib/command-shortcuts'

type SendResult = { ok?: boolean; keepAttachments?: boolean } | void
interface Props {
  onSend: (args: { text: string; displayText?: string; attachments?: File[]; uploadFields?: Record<string, string> }) => SendResult | Promise<SendResult>
  onStop?: () => void
  disabled?: boolean
  isWorking?: boolean
  placeholder?: string
  mode?: 'command' | 'field'
}

function shouldRequestBrowserLocation(prompt: string) {
  const t = prompt.toLowerCase().replace(/[’']/g, "'")
  const relayedInfo = /\b(customer|homeowner|owner|tenant|renter|adjuster|roofer|crew|sub|sales|pm)\s+(?:texted|messaged|emailed|called|said|told|sent)|\b(?:text|message|email|call)\s+(?:from|came in|said)|\b(?:scope|estimate|document|pdf|file|photo|image|report)\s+(?:says|said|shows|mentions|lists|has)|\b(?:according to|from the pdf|from the document|from the file|uploaded scope|uploaded estimate)\b/i.test(t)
  const asksHere = /\b(where i'?m at|where i am|right here|use my location|my location|current location|near me|nearby|gps|where we are|where i'm standing|where i am standing|here right now|address i'?m at|address i am at|this address i'?m at|this address i am at)\b/i.test(t)
  const fieldIntent = /\b(canvass|canvassing|door|knock|street|field|lead|property|house|map|route|inspection|appointment|jobsite|job site|arrived|onsite|on site)\b/i.test(t)
  const liveFieldMoment = /\b(walking up|walk up|i'?m here|i arrived|arrived|just landed|landed (an? )?inspection|got (an? )?inspection|set (an? )?inspection|at the house|at the property|outside mowing)\b/i.test(t)
  const doorOrFieldLog = /\b(knocking|knocked|door knock|approaching (?:the )?door|at (?:the|this) door|someone answered|no answer|not interested|interested|follow[- ]?up|talked to (?:the )?(?:homeowner|customer|owner|tenant)|spoke with (?:the )?(?:homeowner|customer|owner|tenant)|left (?:a )?(?:card|flyer|door hanger))\b/i.test(t)
  const damageOrPropertySignal = /\b(roof damage|missing shingles?|creased shingles?|lifted shingles?|wind damage|hail damage|dents?|dented|soft metals?|gutters?|vents?|screens?|window screen|collateral|fence damage|interior leak|ceiling stain|water stain|attic leak|tarp|new roof|old roof|no soliciting|do not knock|renters?|tenants?|vacant|dog|gate locked)\b/i.test(t)
  const liveObservationLanguage = /\b(i saw|i see|seeing|noticed|observed|from (?:the )?ground|from driveway|from street|standing|walking around|on (?:the )?roof|during (?:the )?inspection|at (?:the )?inspection)\b/i.test(t)
  const livePropertyNote = (liveObservationLanguage && damageOrPropertySignal) || /\b(no soliciting|do not knock|renters?|tenants?|vacant|dog|gate locked)\b/i.test(t)
  const terseFieldDamageNote = !relayedInfo && damageOrPropertySignal && t.split(/\s+/).filter(Boolean).length <= 10
  return asksHere || liveFieldMoment || doorOrFieldLog || (!relayedInfo && livePropertyNote) || terseFieldDamageNote || (fieldIntent && /\b(here|right now|current|nearby|near me|gps|location|where i am|where i'm at)\b/i.test(t))
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

function browserLocationUploadFields(pos: GeolocationPosition): Record<string, string> {
  const { latitude, longitude, accuracy } = pos.coords
  return {
    captureLatitude: String(latitude),
    captureLongitude: String(longitude),
    captureAccuracyMeters: String(Math.round(accuracy)),
    captureSource: 'browser_gps',
    capturedAt: new Date().toISOString(),
  }
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

function shouldCaptureLocationForUpload(input: {
  mode: Props['mode']
  prompt: string
  files: File[]
  uploadFields?: Record<string, string>
}) {
  if (!input.files.length) return false
  const fields = input.uploadFields ?? {}
  if (['company_logo', 'company_pricing', 'company_document', 'company_profile', 'user_avatar'].includes(fields.uploadPurpose)) return false
  if (fields.uploadPurpose === 'inspection_photo' || fields.photoSection || fields.photoSectionLabel) return true
  const lower = `${input.prompt} ${input.files.map(file => file.name).join(' ')}`.toLowerCase()
  const hasImage = input.files.some(file => file.type.startsWith('image/'))
  if (shouldRequestBrowserLocation(input.prompt)) return true
  if (input.mode === 'field' && hasImage) return true
  return hasImage && /\b(field|inspection|roof|damage|elevation|interior|attic|detached|gutter|vent|slope|facet|hail|wind|jobsite|job site|current project|this job|this property)\b/.test(lower)
}

export function ChatInput({ onSend, onStop, disabled, isWorking, placeholder, mode = 'command' }: Props) {
  const [text, setText] = useState(''); const [pendingFiles, setPendingFiles] = useState<File[]>([]); const [showAttachMenu, setShowAttachMenu] = useState(false); const [listening, setListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [shortcuts, setShortcuts] = useState<CommandShortcut[]>(DEFAULT_COMMAND_SHORTCUTS)
  const [shortcutSheetGroupId, setShortcutSheetGroupId] = useState<string | null>(null)
  const [inspectionPickerOpen, setInspectionPickerOpen] = useState(false)
  const [inspectionSectionId, setInspectionSectionId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null); const cameraInputRef = useRef<HTMLInputElement>(null); const textareaRef = useRef<HTMLTextAreaElement>(null); const recognitionRef = useRef<any>(null)
  const textRef = useRef(text); useEffect(() => { textRef.current = text }, [text])
  const selectedInspectionSection = inspectionSectionId ? INSPECTION_PHOTO_SECTIONS.find(s => s.id === inspectionSectionId) ?? null : null

  // Check speech support on client only — prevents hydration mismatch
  useEffect(() => {
    setSpeechSupported(!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition)
  }, [])

  useEffect(() => {
    const load = () => {
      try {
        const local = parseStoredCommandShortcuts(
          window.localStorage.getItem(COMMAND_SHORTCUTS_KEY),
          window.localStorage.getItem(LEGACY_CUSTOM_SHORTCUTS_KEY),
        )
        setShortcuts(local)
        fetch('/api/command-shortcuts')
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (!data?.shortcuts?.length) return
            const remote = parseStoredCommandShortcuts(JSON.stringify(data.shortcuts))
            setShortcuts(remote)
            window.localStorage.setItem(COMMAND_SHORTCUTS_KEY, JSON.stringify(remote))
            if (data.source === 'defaults' && local.some(shortcut => !DEFAULT_COMMAND_SHORTCUTS.some(base => base.id === shortcut.id))) {
              fetch('/api/command-shortcuts', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shortcuts: local, scope: 'user' }),
              }).catch(() => null)
            }
          })
          .catch(() => null)
      } catch {}
    }
    load()
    window.addEventListener(COMMAND_SHORTCUTS_UPDATED_EVENT, load)
    window.addEventListener('storage', load)
    return () => {
      window.removeEventListener(COMMAND_SHORTCUTS_UPDATED_EVENT, load)
      window.removeEventListener('storage', load)
    }
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

  useEffect(() => {
    const openFilePicker = () => fileInputRef.current?.click()
    const openCamera = () => cameraInputRef.current?.click()
    const openInspectionIntake = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string; sectionId?: string }>).detail
      const requested = detail?.sectionId || detail?.section
      const match = requested ? INSPECTION_PHOTO_SECTIONS.find(s => s.id === requested || s.label.toLowerCase() === requested.toLowerCase()) : null
      setInspectionSectionId(match?.id ?? null)
      setInspectionPickerOpen(true)
      setShowAttachMenu(false)
      setLocalError(null)
    }
    window.addEventListener('jobrolo:open-file-picker', openFilePicker)
    window.addEventListener('jobrolo:open-camera', openCamera)
    window.addEventListener('jobrolo:open-inspection-photo-intake', openInspectionIntake)
    return () => {
      window.removeEventListener('jobrolo:open-file-picker', openFilePicker)
      window.removeEventListener('jobrolo:open-camera', openCamera)
      window.removeEventListener('jobrolo:open-inspection-photo-intake', openInspectionIntake)
    }
  }, [])

  useEffect(() => { const ta = textareaRef.current; if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px' }, [text])

  useEffect(() => {
    if (mode === 'field') return
    setInspectionPickerOpen(false)
    setInspectionSectionId(null)
    if (!pendingFiles.length && isGeneratedInspectionPrompt(textRef.current)) {
      setText('')
    }
  }, [mode, pendingFiles.length])

  const handleSend = useCallback(async () => {
    const t = text.trim()
    if (!t && !pendingFiles.length) return
    if (disabled || submitting) return
    setLocalError(null)
    setSubmitting(true)
    const filesToSend = [...pendingFiles]
    try {
      let finalText = t
      const uploadFields = selectedInspectionSection && filesToSend.length
        ? {
            uploadPurpose: 'inspection_photo',
            photoSection: selectedInspectionSection.id,
            photoSectionLabel: selectedInspectionSection.label,
          }
        : undefined
      const needsTextLocation = Boolean(t && shouldRequestBrowserLocation(t))
      const needsUploadLocation = shouldCaptureLocationForUpload({ mode, prompt: t, files: filesToSend, uploadFields })
      let locationFields: Record<string, string> = {}
      if (needsTextLocation || needsUploadLocation) {
        setLocalError('Requesting your location… allow it in the browser popup so Jobrolo can use where you are right now.')
        try {
          const locationPosition = await getBrowserLocation()
          locationFields = browserLocationUploadFields(locationPosition)
          if (needsTextLocation && t) finalText = appendBrowserLocation(t, locationPosition)
          setLocalError(null)
        } catch (err) {
          if (needsTextLocation) {
            setLocalError(browserLocationErrorMessage(err))
            return
          }
          setLocalError(`${browserLocationErrorMessage(err)} I can still save the upload, but it will not include GPS evidence.`)
        }
      }
      const result = await onSend({ text: finalText, displayText: t, attachments: filesToSend, uploadFields: { ...uploadFields, ...locationFields } })
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
  }, [text, pendingFiles, disabled, submitting, onSend, selectedInspectionSection])
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }
  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const selected = Array.from(files).filter(file => file.size > 0)
    if (!selected.length) return
    console.log('[chat-input] files selected:', selected.map(file => ({ name: file.name, size: file.size, type: file.type || 'unknown' })))
    setLocalError(null)
    setPendingFiles(p => [...p, ...selected])
    if (selectedInspectionSection && !textRef.current.trim()) {
      setText(inspectionPromptForSection(selectedInspectionSection))
    } else if (selectedInspectionSection && isGeneratedInspectionPrompt(textRef.current)) {
      setText(inspectionPromptForSection(selectedInspectionSection))
    }
    setShowAttachMenu(false)
    window.setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }, 0)
  }
  const openInspectionIntake = (sectionId?: string | null) => {
    setInspectionSectionId(sectionId ?? null)
    setInspectionPickerOpen(true)
    setShowAttachMenu(false)
    setLocalError(null)
  }
  const chooseInspectionSection = (sectionId: string) => {
    const section = INSPECTION_PHOTO_SECTIONS.find(s => s.id === sectionId)
    setInspectionSectionId(sectionId)
    if (section && (!textRef.current.trim() || isGeneratedInspectionPrompt(textRef.current))) setText(inspectionPromptForSection(section))
  }
  const openInspectionPicker = (source: 'camera' | 'file') => {
    if (!selectedInspectionSection) {
      setLocalError('Pick the photo section first, then take or upload the photos.')
      return
    }
    if (!textRef.current.trim() || isGeneratedInspectionPrompt(textRef.current)) setText(inspectionPromptForSection(selectedInspectionSection))
    if (source === 'camera') cameraInputRef.current?.click()
    else fileInputRef.current?.click()
  }
  const insertPrompt = (prompt: string) => {
    setText(prompt)
    setShowAttachMenu(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const runShortcut = (shortcut: CommandShortcut) => {
    if (!shortcut.id.startsWith('custom-')) {
      fetch(`/api/command-shortcuts/${encodeURIComponent(shortcut.id)}`, { method: 'POST' }).catch(() => null)
    }
    if (shortcut.icon === 'field' || shortcut.id.startsWith('field-')) {
      runFieldQuickPrompt(shortcut, openInspectionIntake, setText)
      return
    }
    insertPrompt(shortcut.prompt)
  }
  const promptShortcutEdit = (shortcut: CommandShortcut) => {
    setShortcutSheetGroupId(null)
    insertPrompt(`Edit shortcut "${shortcut.label}". New title: ${shortcut.label}. New prompt: ${shortcut.prompt}`)
  }
  const promptShortcutCreate = (group: PromptGroup) => {
    setShortcutSheetGroupId(null)
    insertPrompt(`Add a new ${group.label.toLowerCase()} shortcut. Title: . Prompt: .`)
  }
  const deleteShortcut = async (shortcut: CommandShortcut) => {
    const isDefault = DEFAULT_COMMAND_SHORTCUTS.some(base => base.id === shortcut.id)
    if (isDefault || shortcut.id.startsWith('custom-')) {
      setShortcutSheetGroupId(null)
      insertPrompt(`Delete shortcut "${shortcut.label}".`)
      return
    }
    try {
      const res = await fetch(`/api/command-shortcuts/${encodeURIComponent(shortcut.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not delete shortcut')
      const data = await res.json()
      const remote = parseStoredCommandShortcuts(JSON.stringify(data.shortcuts ?? []))
      setShortcuts(remote)
      window.localStorage.setItem(COMMAND_SHORTCUTS_KEY, JSON.stringify(remote))
      window.dispatchEvent(new Event(COMMAND_SHORTCUTS_UPDATED_EVENT))
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not delete shortcut.')
    }
  }

  const startListening = () => { if (listening) { recognitionRef.current?.stop(); setListening(false); return } const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) return; const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'; let ft = textRef.current; rec.onresult = (e: any) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const tr = e.results[i][0].transcript; if (e.results[i].isFinal) ft += tr; else interim += tr } setText(ft); setInterimText(interim) }; rec.onend = () => setListening(false); rec.onerror = () => setListening(false); rec.start(); recognitionRef.current = rec; setListening(true) }
  const [interimText, setInterimText] = useState('')
  const promptGroups = promptGroupsFor(mode, shortcuts)
  const uploadPromptGroups = pendingFiles.length ? uploadPromptGroupsFor(mode, pendingFiles) : []
  const shortcutRailGroups = pendingFiles.length ? uploadPromptGroups : promptGroups
  const shouldShowShortcutRail = !text.trim() && !listening && shortcutRailGroups.length > 0
  const activeShortcutGroup = shortcutSheetGroupId ? shortcutRailGroups.find(group => group.id === shortcutSheetGroupId) ?? null : null

  useEffect(() => {
    if (text.trim()) setShortcutSheetGroupId(null)
  }, [text])

  return (
    <div className="border-t border-border bg-card px-3 sm:px-4 pt-2.5 pb-2.5">
      {pendingFiles.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{pendingFiles.map((f, i) => <PendingFileChip key={i} file={f} onRemove={() => setPendingFiles(p => p.filter((_, idx) => idx !== i))} />)}</div>}
      {localError ? <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">{localError}</div> : null}
      {inspectionPickerOpen ? (
        <InspectionPhotoIntakeCard
          selectedSectionId={inspectionSectionId}
          onSelectSection={chooseInspectionSection}
          onTakePhoto={() => openInspectionPicker('camera')}
          onUpload={() => openInspectionPicker('file')}
          onClose={() => setInspectionPickerOpen(false)}
        />
      ) : null}
      {shouldShowShortcutRail ? <PromptAssistantRail groups={shortcutRailGroups} onOpenGroup={group => setShortcutSheetGroupId(group.id)} /> : null}
      {activeShortcutGroup ? (
        <ShortcutGroupSheet
          group={activeShortcutGroup}
          onRun={(shortcut) => {
            setShortcutSheetGroupId(null)
            runShortcut(shortcut)
          }}
          onEdit={promptShortcutEdit}
          onDelete={deleteShortcut}
          onAdd={() => promptShortcutCreate(activeShortcutGroup)}
          onClose={() => setShortcutSheetGroupId(null)}
        />
      ) : null}
      {listening && <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900/60 dark:bg-blue-950/30"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" /></span><span className="text-sm font-medium text-blue-800 dark:text-blue-100">Listening{interimText ? `: ${interimText}` : '…'}</span></div>}
      <div className="flex items-end gap-2">
        <div className="relative flex-shrink-0"><button onClick={() => setShowAttachMenu(v => !v)} disabled={disabled || submitting} className="p-2.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Add photo or file"><Plus className="w-5 h-5" /></button>
          {showAttachMenu && (<><div className="fixed inset-0 z-10" onClick={() => setShowAttachMenu(false)} /><div className="absolute bottom-12 left-0 z-20 max-h-[70vh] min-w-[260px] overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg">
            {mode === 'field' ? <MenuButton icon={<Camera className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />} label="Inspection photos" hint="Choose roof/interior/attic section" onClick={() => openInspectionIntake(null)} /> : null}
            <MenuButton icon={<Camera className="w-5 h-5 text-blue-600 dark:text-blue-300" />} label="Take photo" hint="Save field photos" onClick={() => { setShowAttachMenu(false); cameraInputRef.current?.click() }} />
            <MenuButton icon={<Paperclip className="w-5 h-5 text-muted-foreground" />} label="Attach file" hint="PDFs, docs, images" onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click() }} />
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

const FIELD_QUICK_PROMPTS: CommandShortcut[] = [
  { id: 'field-open-map', label: 'Open map', prompt: 'Open map.', icon: 'field' },
  makeCommandShortcut('Start inspection', 'I landed an inspection here. Use my location, research the property if configured, and start an inspection photo workflow.', 'field'),
  makeCommandShortcut('Photo checklist', 'Give me the first inspection photo checklist for this property: front elevation, all elevations, roof slopes, damage, soft metals, interior, attic, detached structures, and documents.', 'field'),
  makeCommandShortcut('Roof photos', 'Start roof photo capture. Ask me for roof overview, slopes/facets, penetrations, ridges, valleys, gutters, vents, and damage photos by section.', 'field'),
  makeCommandShortcut('Interior', 'Log interior inspection notes/photos. Ask me for room, ceiling/wall damage, moisture, and supporting photos.', 'field'),
  makeCommandShortcut('Attic', 'Log attic inspection notes/photos. Ask me for decking, moisture, daylight, ventilation, and structural concerns.', 'field'),
  makeCommandShortcut('Detached', 'Log detached structure inspection notes/photos for this property.', 'field'),
]

const INSPECTION_PHOTO_SECTIONS = [
  { id: 'front_elevation', label: 'Front elevation', hint: 'Street view, house number if visible, whole front.' },
  { id: 'all_elevations', label: 'All elevations', hint: 'Each side of the home before roof detail shots.' },
  { id: 'roof_overview', label: 'Roof photos', hint: 'Overview, slopes, facets, ridges, valleys, penetrations.' },
  { id: 'damage', label: 'Damage', hint: 'Hail, wind, creased shingles, collateral closeups.' },
  { id: 'soft_metals', label: 'Soft metals', hint: 'Gutters, vents, drip edge, flashing, screens.' },
  { id: 'interior', label: 'Interior', hint: 'Ceilings, walls, moisture, room context, closeups.' },
  { id: 'attic', label: 'Attic', hint: 'Decking, leaks, daylight, ventilation, framing.' },
  { id: 'detached', label: 'Detached', hint: 'Shed, garage, fence, pergola, detached structures.' },
  { id: 'documents', label: 'Documents', hint: 'Scope, estimate, invoice, contract, claim paperwork.' },
] as const

type InspectionPhotoSection = (typeof INSPECTION_PHOTO_SECTIONS)[number]

function fieldShortcutSectionId(label: string) {
  const lower = label.toLowerCase()
  if (lower.includes('roof')) return 'roof_overview'
  if (lower.includes('interior')) return 'interior'
  if (lower.includes('attic')) return 'attic'
  if (lower.includes('detached')) return 'detached'
  return null
}

function runFieldQuickPrompt(shortcut: CommandShortcut, openInspectionIntake: (sectionId?: string | null) => void, setPromptText: (value: string) => void) {
  const label = shortcut.label.toLowerCase()
  if (shortcut.id === 'field-open-map' || label.includes('map')) {
    window.dispatchEvent(new Event('jobrolo:open-field-map'))
    return
  }
  if (label.includes('start inspection') || label.includes('photo checklist')) {
    setPromptText(shortcut.prompt)
    return
  }
  openInspectionIntake(fieldShortcutSectionId(shortcut.label))
}

function inspectionPromptForSection(section: InspectionPhotoSection) {
  const label = inspectionSectionUploadLabel(section)
  return `Upload these ${label} for this job. Save them to the current project/job file, tag them as "${section.label}", analyze what they show, and tell me what photo section is still missing.`
}

function isGeneratedInspectionPrompt(value: string) {
  return /^Upload these .+ for this job\. Save them to the current project\/job file, tag them as ".+", analyze what they show, and tell me what photo section is still missing\.$/.test(value.trim())
}

function inspectionSectionUploadLabel(section: InspectionPhotoSection) {
  const label = section.label.toLowerCase()
  return label.includes('photo') ? label : `${label} inspection photos`
}

function InspectionPhotoIntakeCard({
  selectedSectionId,
  onSelectSection,
  onTakePhoto,
  onUpload,
  onClose,
}: {
  selectedSectionId: string | null
  onSelectSection: (sectionId: string) => void
  onTakePhoto: () => void
  onUpload: () => void
  onClose: () => void
}) {
  const selected = selectedSectionId ? INSPECTION_PHOTO_SECTIONS.find(s => s.id === selectedSectionId) : null
  return (
    <div className="mb-2 max-h-[58dvh] overflow-y-auto rounded-2xl border border-emerald-300/60 bg-emerald-50 p-3 shadow-sm dark:border-emerald-900/70 dark:bg-emerald-950/25">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-50">Inspection photo capture</div>
          <div className="text-xs text-emerald-900/70 dark:text-emerald-100/70">Stays open while this inspection is active. Pick a section, then take or upload photos.</div>
        </div>
        <button type="button" onClick={onClose} className="inline-flex min-h-[34px] items-center gap-1 rounded-full px-2 text-xs font-medium text-emerald-950/70 hover:bg-emerald-100 dark:text-emerald-100/80 dark:hover:bg-emerald-900/40" aria-label="Close inspection photo capture">
          <X className="h-4 w-4" />
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {INSPECTION_PHOTO_SECTIONS.map(section => (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelectSection(section.id)}
            className={cn(
              'rounded-xl border px-2.5 py-2 text-left text-xs transition-colors',
              selectedSectionId === section.id
                ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
                : 'border-emerald-200 bg-background/80 text-foreground hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-background/60 dark:hover:bg-emerald-950/60'
            )}
          >
            <div className="font-medium">{section.label}</div>
            <div className={cn('mt-0.5 line-clamp-2 text-[10px]', selectedSectionId === section.id ? 'text-white/80' : 'text-muted-foreground')}>{section.hint}</div>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onTakePhoto} className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">
          <Camera className="h-4 w-4" />
          Take photo
        </button>
        <button type="button" onClick={onUpload} className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-background px-3 text-sm font-medium text-foreground hover:bg-emerald-50 dark:border-emerald-900/70 dark:hover:bg-emerald-950/40">
          <Paperclip className="h-4 w-4" />
          Upload
        </button>
      </div>
      <button type="button" onClick={onClose} className="mt-2 inline-flex min-h-[36px] w-full items-center justify-center rounded-xl border border-emerald-300 bg-background/80 px-3 text-xs font-semibold text-emerald-950 hover:bg-emerald-50 dark:border-emerald-900/70 dark:text-emerald-100 dark:hover:bg-emerald-950/40">
        Complete inspection photo set
      </button>
      <div className="mt-2 text-[11px] text-emerald-900/75 dark:text-emerald-100/70">
        {selected ? `Selected: ${selected.label}. Photos will be tagged with this section when you send.` : 'Select a section first so Jobrolo does not have to guess what these photos are.'}
      </div>
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

type PromptTone = 'field' | 'sales' | 'files' | 'company' | 'personal'

type PromptGroup = {
  id: string
  label: string
  reason: string
  tone: PromptTone
  shortcuts: CommandShortcut[]
}

function promptGroupsFor(mode: 'command' | 'field', shortcuts: CommandShortcut[]): PromptGroup[] {
  const commandShortcuts: PromptGroup = {
    id: 'shortcuts',
    label: 'Shortcuts',
    reason: 'your prompts',
    tone: 'personal',
    shortcuts: shortcuts.slice(0, 7),
  }
  const field: PromptGroup = {
    id: 'field',
    label: 'Field',
    reason: mode === 'field' ? 'inspection tools' : 'location + inspections',
    tone: 'field',
    shortcuts: FIELD_QUICK_PROMPTS,
  }
  const sales: PromptGroup = {
    id: 'sales',
    label: 'Sales',
    reason: 'leads + clients',
    tone: 'sales',
    shortcuts: [
      makeCommandShortcut('Saved clients', 'Only use saved database records. Show me my saved clients and any active projects.', 'client'),
      makeCommandShortcut('Create lead', 'Create a new potential lead. Ask me for any missing homeowner, phone, address, source, and notes.', 'client'),
      makeCommandShortcut('Customer update', 'Draft a friendly customer update for the current customer or project. Ask what changed if needed.', 'customer'),
      makeCommandShortcut('Follow up', 'Show me who needs follow-up today from saved tasks, leads, customers, and projects.', 'attention'),
      makeCommandShortcut('Customer chat', 'Create a customer-facing chat for this customer/project and give me the invite/link card.', 'customer'),
    ],
  }
  const files: PromptGroup = {
    id: 'files',
    label: 'Files',
    reason: 'docs + photos',
    tone: 'files',
    shortcuts: [
      makeCommandShortcut('Show files', 'Only use saved database records. Show me the files for the current customer or project with clickable file cards.', 'template'),
      makeCommandShortcut('Review docs', 'Show documents that need review, what each one is, and what decision is needed.', 'attention'),
      makeCommandShortcut('Price rows', 'Review the first 10 extracted price sheet rows with unit and price, and tell me whether they are pending import or already saved.', 'template'),
      makeCommandShortcut('Save scope', 'Save this pasted or uploaded scope to the correct customer/project file. If a project is missing, create or ask before saving.', 'roof'),
      makeCommandShortcut('Roof report', 'Start a roof report from the current project files/photos, then finish it in chat instead of opening a builder page.', 'roof'),
    ],
  }
  const company: PromptGroup = {
    id: 'company',
    label: 'Company',
    reason: 'profile + brand',
    tone: 'company',
    shortcuts: [
      makeCommandShortcut('Company profile', 'Show my saved company profile as a card. Include missing items for estimates, invoices, reports, contracts, and signatures.', 'building'),
      makeCommandShortcut('Research website', 'Research my company website and online presence, dedupe sources, show link previews, and suggest profile updates before saving.', 'globe'),
      makeCommandShortcut('Update company info', 'Update my company profile from chat. Ask for only the missing field or correction you need.', 'building'),
      makeCommandShortcut('Add logo', 'I want to add my company logo to my company profile for estimates, invoices, reports, contracts, and signatures.', 'building'),
    ],
  }
  const custom = shortcuts
    .filter(shortcut => !DEFAULT_COMMAND_SHORTCUTS.some(base => base.id === shortcut.id))
    .slice(0, 7)

  return [
    ...(mode === 'field' ? [field, commandShortcuts, sales, files, company] : [commandShortcuts, sales, files, field, company]),
    ...(custom.length ? [{ id: 'personal', label: 'My shortcuts', reason: 'your saved prompts', tone: 'personal' as const, shortcuts: custom }] : []),
  ].filter(group => group.shortcuts.length)
}

function uploadPromptGroupsFor(mode: 'command' | 'field', files: File[]): PromptGroup[] {
  const fileSummary = describePendingUpload(files)
  const hasImage = files.some(file => file.type.startsWith('image/'))
  const hasPdf = files.some(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
  const maybePriceSheet = files.some(file => /price|material|supply|supplier|abc|qxo|texas direct|price[-_\s]?list/i.test(file.name))
  const maybeScope = files.some(file => /scope|estimate|claim|xact|loss|roof/i.test(file.name)) || hasPdf

  const uploadReview: PromptGroup = {
    id: 'upload-review',
    label: 'Upload',
    reason: `${fileSummary} staged`,
    tone: 'files',
    shortcuts: [
      makeCommandShortcut('Review upload', `Review the staged upload (${fileSummary}). Identify what it is, summarize it, and tell me whether it belongs to a customer, project/job, company pricing, company profile, or review queue before saving or linking anything else.`, 'file'),
      makeCommandShortcut('Show saved result', `After this upload is saved, show me the saved file card with a clickable preview/download link and the document ID. Use the staged upload (${fileSummary}).`, 'file'),
      makeCommandShortcut('Ask where it belongs', `Save this staged upload (${fileSummary}) first, then ask me which customer, project/job, company profile, or company pricing area it should be attached to.`, 'file'),
    ],
  }

  const job: PromptGroup = {
    id: 'upload-job',
    label: 'Job',
    reason: 'attach + save',
    tone: 'field',
    shortcuts: [
      makeCommandShortcut('Attach to current job', `Save this staged upload (${fileSummary}) to the current project/job file. If there is no current project, ask me which customer or job first.`, 'job'),
      makeCommandShortcut('Create job from upload', `Read this staged upload (${fileSummary}), extract customer/property/project details, detect conflicts with saved records, then create or suggest the correct project/job before linking it.`, 'job'),
      ...(maybeScope ? [makeCommandShortcut('Save scope', `Read this staged scope/estimate upload (${fileSummary}), extract the scope breakdown, deductible, totals, trades, and line items, then save it to the correct customer/project file after resolving any missing project or customer.`, 'roof')] : []),
    ],
  }

  const sales: PromptGroup = {
    id: 'upload-sales',
    label: 'Sales',
    reason: 'lead + client',
    tone: 'sales',
    shortcuts: [
      makeCommandShortcut('Find customer', `Use the staged upload (${fileSummary}) to look for homeowner/customer name, phone, email, address, claim info, and project address. Compare it to saved customers and show matches or conflicts.`, 'client'),
      makeCommandShortcut('Create lead', `Create a lead from this staged upload (${fileSummary}). Extract any homeowner, phone, address, source, and notes. Ask me only for missing required details.`, 'client'),
      makeCommandShortcut('Customer update', `Draft a customer-facing update based on this staged upload (${fileSummary}). Do not claim anything is saved unless it is actually attached to the customer/project file.`, 'customer'),
    ],
  }

  const pricing: PromptGroup = {
    id: 'upload-pricing',
    label: 'Pricing',
    reason: 'price sheets',
    tone: 'company',
    shortcuts: [
      makeCommandShortcut('Review price sheet', `Treat this staged upload (${fileSummary}) as a supplier/material price sheet if applicable. Extract supplier, effective date, first 10 rows, unit, price, and import status. Keep rows pending review; do not import yet.`, 'template'),
      makeCommandShortcut('Save company pricing', `If this staged upload (${fileSummary}) is a company price sheet, save it under company pricing/material costs, not under a customer file. Ask before importing rows into the material database.`, 'template'),
    ],
  }

  const photos: PromptGroup = {
    id: 'upload-photos',
    label: 'Photos',
    reason: 'tag + inspect',
    tone: 'field',
    shortcuts: [
      makeCommandShortcut('Tag job photos', `Save these staged photos (${fileSummary}) to the current project/job file, group them by exterior, interior, roof, damage, documents, and other, then ask me to confirm any uncertain tags.`, 'file'),
      makeCommandShortcut('Inspection photos', `Use these staged photos (${fileSummary}) as inspection photos for the current job. Tag the section, attach GPS if available, analyze what they show, and keep the inspection workflow open until I complete it.`, 'file'),
      makeCommandShortcut('Company logo/avatar', `If this staged image (${fileSummary}) is a logo or profile photo, ask whether it should update the company logo or my user profile photo. Do not attach it to a customer/project by default.`, 'building'),
    ],
  }

  return [
    uploadReview,
    job,
    sales,
    ...(maybePriceSheet || hasPdf ? [pricing] : []),
    ...(hasImage ? [photos] : []),
    ...(mode === 'field' && !hasImage ? [photos] : []),
  ].filter(group => group.shortcuts.length)
}

function describePendingUpload(files: File[]) {
  if (files.length === 1) return files[0]?.name || '1 file'
  const images = files.filter(file => file.type.startsWith('image/')).length
  const pdfs = files.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')).length
  const parts = [
    images ? `${images} photo${images === 1 ? '' : 's'}` : '',
    pdfs ? `${pdfs} PDF${pdfs === 1 ? '' : 's'}` : '',
    files.length - images - pdfs > 0 ? `${files.length - images - pdfs} file${files.length - images - pdfs === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : `${files.length} files`
}

function promptGroupTone(tone: PromptTone) {
  switch (tone) {
    case 'field':
      return {
        label: 'text-emerald-700 dark:text-emerald-200',
        pill: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-950 hover:bg-emerald-500/18 dark:text-emerald-100',
        card: 'border-emerald-400/45 bg-emerald-500/[0.07] shadow-[0_0_22px_rgba(16,185,129,0.16)] hover:bg-emerald-500/[0.12] hover:shadow-[0_0_30px_rgba(16,185,129,0.24)]',
        add: 'bg-emerald-600 text-white hover:bg-emerald-700',
      }
    case 'sales':
      return {
        label: 'text-blue-700 dark:text-blue-200',
        pill: 'border-blue-400/25 bg-blue-500/10 text-blue-950 hover:bg-blue-500/18 dark:text-blue-100',
        card: 'border-blue-400/45 bg-blue-500/[0.07] shadow-[0_0_22px_rgba(59,130,246,0.16)] hover:bg-blue-500/[0.12] hover:shadow-[0_0_30px_rgba(59,130,246,0.24)]',
        add: 'bg-blue-600 text-white hover:bg-blue-700',
      }
    case 'files':
      return {
        label: 'text-amber-700 dark:text-amber-200',
        pill: 'border-amber-400/25 bg-amber-500/10 text-amber-950 hover:bg-amber-500/18 dark:text-amber-100',
        card: 'border-amber-400/45 bg-amber-500/[0.07] shadow-[0_0_22px_rgba(245,158,11,0.14)] hover:bg-amber-500/[0.12] hover:shadow-[0_0_30px_rgba(245,158,11,0.22)]',
        add: 'bg-amber-500 text-black hover:bg-amber-400',
      }
    case 'company':
      return {
        label: 'text-violet-700 dark:text-violet-200',
        pill: 'border-violet-400/25 bg-violet-500/10 text-violet-950 hover:bg-violet-500/18 dark:text-violet-100',
        card: 'border-violet-400/45 bg-violet-500/[0.07] shadow-[0_0_22px_rgba(139,92,246,0.16)] hover:bg-violet-500/[0.12] hover:shadow-[0_0_30px_rgba(139,92,246,0.24)]',
        add: 'bg-violet-600 text-white hover:bg-violet-700',
      }
    default:
      return {
        label: 'text-slate-700 dark:text-slate-200',
        pill: 'border-slate-400/25 bg-slate-500/10 text-slate-950 hover:bg-slate-500/18 dark:text-slate-100',
        card: 'border-slate-400/35 bg-slate-500/[0.07] shadow-[0_0_20px_rgba(148,163,184,0.12)] hover:bg-slate-500/[0.12] hover:shadow-[0_0_28px_rgba(148,163,184,0.2)]',
        add: 'bg-slate-700 text-white hover:bg-slate-600',
      }
  }
}

function PromptAssistantRail({ groups, onOpenGroup }: { groups: PromptGroup[]; onOpenGroup: (group: PromptGroup) => void }) {
  if (!groups.length) return null

  return (
    <div className="mb-1 -mx-3 overflow-x-auto overscroll-x-contain px-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-h-[34px] w-max items-center gap-1.5 pr-3">
        {groups.map(group => {
          const tone = promptGroupTone(group.tone)
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onOpenGroup(group)}
              className={cn('inline-flex min-h-[32px] max-w-[48vw] shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors', tone.pill)}
            >
              <span className="truncate">{group.label}</span>
              <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] dark:bg-white/10">{group.shortcuts.length}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ShortcutGroupSheet({
  group,
  onRun,
  onEdit,
  onDelete,
  onAdd,
  onClose,
}: {
  group: PromptGroup
  onRun: (shortcut: CommandShortcut) => void
  onEdit: (shortcut: CommandShortcut) => void
  onDelete: (shortcut: CommandShortcut) => void
  onAdd: () => void
  onClose: () => void
}) {
  const tone = promptGroupTone(group.tone)
  const [editing, setEditing] = useState(false)
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/25 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+84px)] bottom-[calc(env(safe-area-inset-bottom)+86px)] z-40 mx-auto flex max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card/98 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className={cn('text-xs font-semibold uppercase tracking-[0.16em]', tone.label)}>{group.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {editing ? 'Edit this section, add prompts, or remove ones you do not use.' : `${group.reason}. Tap a prompt to use it.`}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => setEditing(value => !value)} className="min-h-[32px] rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted">
              {editing ? 'Done editing' : 'Edit'}
            </button>
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted" aria-label="Close shortcuts">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            {group.shortcuts.map(shortcut => (
              <div key={shortcut.id} className={cn('rounded-2xl border p-3 transition-all', tone.card)}>
                <button type="button" onClick={() => !editing && onRun(shortcut)} className="block min-h-[68px] w-full text-left">
                  <div className="text-sm font-semibold text-foreground">{shortcut.label}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{shortcut.prompt}</div>
                </button>
                {editing ? (
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-2">
                    <button type="button" onClick={() => onEdit(shortcut)} className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Edit prompt</button>
                    <button type="button" onClick={() => onDelete(shortcut)} className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">Delete</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-2 border-t border-border bg-card/95 p-3">
          {editing ? (
            <button type="button" onClick={onAdd} className={cn('min-h-[40px] flex-1 rounded-xl px-3 text-sm font-semibold', tone.add)}>Add shortcut</button>
          ) : null}
          <button type="button" onClick={onClose} className={cn('min-h-[40px] rounded-xl border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted', !editing && 'flex-1')}>Done</button>
        </div>
      </div>
    </>
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
