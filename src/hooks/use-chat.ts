'use client'
import { useCallback, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import type { ClientMessage, MessageAttachment } from '@/lib/types'
import { attachmentFromDocument, uploadAnalysisFollowupFromDocument, uploadFilesSequentially } from '@/hooks/chat-upload'
import { serializeMessagesForAgentHistory } from '@/hooks/chat-history'

// Terminal states — once a document reaches one of these, we stop polling.
const DOC_TERMINAL_STATES = new Set(['reviewed', 'failed', 'needs_ocr', 'needs_review'])
const DOC_BACKGROUND_STATES = new Set(['queued', 'processing', 'pending_review'])

type DocumentPollResult = { reviewed: boolean; terminal: boolean; status?: string; doc?: any }

type UploadIntentResolution = {
  fields: Record<string, string>
  source: 'direct' | 'recent_context' | 'none'
  suggestedPurpose?: 'company_logo' | 'user_avatar' | 'company_pricing'
}

function uploadIntentFields(text: string, attachments: File[] = []): Record<string, string> {
  const lower = `${text} ${attachments.map(f => f.name).join(' ')}`.toLowerCase()
  if (/\b(profile photo|profile picture|account photo|account picture|avatar|my photo|my picture|user photo|headshot)\b/.test(lower)) {
    return { uploadPurpose: 'user_avatar' }
  }
  if (/\blogo\b/.test(lower) && /\b(company|profile|brand|branding|estimate|invoice|report|contract|signature)\b/.test(lower)) {
    return { uploadPurpose: 'company_logo' }
  }
  if (/\b(price\s*sheet|pricing|material price|supplier price|materials database|material database)\b/.test(lower)) {
    return { uploadPurpose: 'company_pricing' }
  }
  return {}
}

function resolveUploadIntent(text: string, attachments: File[] = [], recentMessages: ClientMessage[] = []): UploadIntentResolution {
  const direct = uploadIntentFields(text, attachments)
  if (direct.uploadPurpose) {
    return { fields: direct, source: 'direct', suggestedPurpose: direct.uploadPurpose as UploadIntentResolution['suggestedPurpose'] }
  }

  // File-only uploads are common on mobile. If the user just asked about a logo,
  // avatar, or price sheet, keep that context so the file does not get buried in
  // the wrong customer/project file.
  const recentUserText = recentMessages
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content || '')
    .join('\n')
  const inferred = uploadIntentFields(recentUserText, attachments)
  const inferredPurpose = inferred.uploadPurpose as UploadIntentResolution['suggestedPurpose']
  if (!inferredPurpose) return { fields: {}, source: 'none' }

  if (inferredPurpose === 'company_pricing') {
    return { fields: { uploadPurpose: 'company_pricing', uploadIntentSource: 'recent_context' }, source: 'recent_context', suggestedPurpose: inferredPurpose }
  }

  return {
    fields: {
      suggestedUploadPurpose: inferredPurpose,
      uploadIntentSource: 'recent_context',
      requireUploadConfirmation: 'true',
    },
    source: 'recent_context',
    suggestedPurpose: inferredPurpose,
  }
}

function uploadIntentConfirmation(intent: UploadIntentResolution, documents: Array<{ id: string; originalName: string }>) {
  if (intent.source !== 'recent_context' || !intent.suggestedPurpose || intent.suggestedPurpose === 'company_pricing') return null
  const first = documents[0]
  if (!first) return null
  const label = intent.suggestedPurpose === 'user_avatar' ? 'profile photo' : 'company logo'
  const action = intent.suggestedPurpose === 'user_avatar' ? 'update your account profile photo' : 'set this as your company logo'
  return {
    content: `Saved ${first.originalName}. Since we were just talking about your ${label}, I kept it out of customer/job files. Do you want me to ${action}?`,
    contextType: 'upload_intent_confirmation',
    contextData: {
      cardType: 'upload_intent_confirmation',
      suggestedUploadPurpose: intent.suggestedPurpose,
      documentIds: documents.map(d => d.id),
      filenames: documents.map(d => d.originalName),
    },
  }
}

function isInstantProfileUpload(doc: { fileType?: string }) {
  return doc.fileType === 'user_avatar' || doc.fileType === 'company_logo'
}

async function pollDocumentStatus(docId: string, userMessageId: string, postAnalysisFollowup = false, maxAttempts = 18, signal?: AbortSignal): Promise<DocumentPollResult> {
  for (let i = 0; i < maxAttempts; i++) { // default 18 * 2s = 36s max wait before the UI moves on
    if (signal?.aborted) return { reviewed: false, terminal: false, status: 'stopped' }
    await new Promise(r => setTimeout(r, 2000))
    if (signal?.aborted) return { reviewed: false, terminal: false, status: 'stopped' }
    try {
      const res = await fetch(`/api/documents/${docId}`); if (!res.ok) continue
      const data = await res.json()
      const doc = data.document
      if (!doc) return { reviewed: false, terminal: true, status: 'missing' }
      if (DOC_TERMINAL_STATES.has(doc.status)) {
        const store = useChatStore.getState()
        const msg = store.messages.find(m => m.id === userMessageId)
        if (msg?.attachments) {
          const updated = msg.attachments.map(a =>
            a.documentId === docId
              ? {
                  ...a,
                  documentStatus: doc.status,
                  documentSummary: doc.aiSummary,
                  documentCategory: doc.aiCategory,
                  documentExtractedData: doc.extractedData,
                }
              : a
          )
          store.updateMessage(userMessageId, { attachments: updated })
        }
        await store.refreshBusinessContext()
        if (postAnalysisFollowup) {
          const followup = uploadAnalysisFollowupFromDocument(doc)
          if (followup) {
            store.addMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: followup.content,
              contextType: followup.contextType,
              contextData: followup.contextData,
              createdAt: new Date().toISOString(),
            })
          }
        }
        // 'reviewed' is success; 'failed' and 'needs_ocr' are terminal but not success
        return { reviewed: doc.status === 'reviewed', terminal: true, status: doc.status, doc }
      }
    } catch {}
  }
  return { reviewed: false, terminal: false, status: 'timeout' }
}

export function useChat() {
  const addMessage = useChatStore(s => s.addMessage)
  const updateMessage = useChatStore(s => s.updateMessage)
  const setTyping = useChatStore(s => s.setTyping)
  const setStreaming = useChatStore(s => s.setStreaming)
  const setStreamingText = useChatStore(s => s.setStreamingText)
  const clearStreamingText = useChatStore(s => s.clearStreamingText)
  const refreshBusinessContext = useChatStore(s => s.refreshBusinessContext)
  const setConversations = useChatStore(s => s.setConversations)
  const clearUploadProgress = useChatStore(s => s.clearUploadProgress)
  const setWorkspaces = useWorkspaceStore(s => s.setWorkspaces)
  const abortRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentJobIdRef = useRef<string | null>(null)

  const stopMessage = useCallback(async () => {
    abortRef.current = true
    abortControllerRef.current?.abort()
    const jobId = currentJobIdRef.current
    currentJobIdRef.current = null
    if (jobId) {
      await fetch('/api/chat/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(() => null)
    }
    setTyping(false)
    setStreaming(false)
    clearStreamingText()
    clearUploadProgress()
    addMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Stopped. Tell me what you want me to do next.',
      createdAt: new Date().toISOString(),
    })
  }, [addMessage, clearStreamingText, clearUploadProgress, setStreaming, setTyping])

  const sendMessage = useCallback(async ({ text, displayText, attachments = [], uploadFields = {} }: { text: string; displayText?: string; attachments?: File[]; uploadFields?: Record<string, string> }) => {
    if (!text.trim() && attachments.length === 0) return
    const visibleText = displayText ?? text
    abortRef.current = false
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const store = useChatStore.getState()
    let activeConversationId = store.conversationId
    if (!activeConversationId) {
      try {
        const r = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: visibleText.slice(0, 60) || 'New Chat' }),
        })
        if (r.ok) {
          const d = await r.json()
          activeConversationId = d.conversation.id as string
          store.setConversationId(activeConversationId)
          store.createConversationLocally(activeConversationId, visibleText.slice(0, 60))
        }
      } catch {}
    }

    const previewAttachments: MessageAttachment[] = attachments.map(f => ({
      type: f.type.startsWith('image/') ? 'image' : 'file',
      name: f.name,
      url: URL.createObjectURL(f),
      mimeType: f.type,
      size: f.size,
    }))
    const previousMessages = store.messages.slice(-8)
    const uploadIntent = resolveUploadIntent(text, attachments, previousMessages)
    const userMessageId = crypto.randomUUID()
    addMessage({ id: userMessageId, role: 'user', content: visibleText, attachments: previewAttachments, createdAt: new Date().toISOString() })

    let uploadedDocIds: string[] = []
    let serverAttachments: MessageAttachment[] = []
    if (attachments.length > 0) {
      try {
        const data = await uploadFilesSequentially(attachments, { signal: abortControllerRef.current.signal, fields: { ...uploadIntent.fields, ...uploadFields } })
        if (data.documents.length === 0) {
          const errMsg = data.failures.map(f => `${f.fileName}: ${f.error}`).join('\n') || 'Upload failed before the server responded'
          console.error('[use-chat] upload failed:', errMsg)
          updateMessage(userMessageId, { content: `${visibleText}\n\n⚠️ Upload failed: ${errMsg}` })
          addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `I couldn't save the upload yet: ${errMsg}\n\nTry one smaller file first. If it still fails, I’ll need the Render upload logs for that exact attempt.`,
            createdAt: new Date().toISOString(),
          })
          clearUploadProgress()
          return { ok: false, keepAttachments: true }
        }

        uploadedDocIds = data.documents.map(d => d.id)
        serverAttachments = data.documents.map(attachmentFromDocument)
          updateMessage(userMessageId, { attachments: serverAttachments })
          const avatarUrl = data.documents.find(d => d.fileType === 'user_avatar')?.avatarUrl
          if (avatarUrl) {
            window.dispatchEvent(new CustomEvent('jobrolo:user-avatar-updated', { detail: { avatarUrl } }))
          }
          for (const doc of data.documents) {
            const locationResolution = (doc as any).locationResolution
            if (locationResolution) {
              addMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: locationResolution.confidenceLabel === 'high'
                  ? `I matched ${doc.originalName} to the most likely job-site location.`
                  : `I found a possible job-site match for ${doc.originalName}. Please confirm before attaching it.`,
                contextType: 'location_confirmation',
                contextData: { ...locationResolution, documentId: doc.id, cardType: 'location_confirmation' },
                createdAt: new Date().toISOString(),
              })
            }
          }
          if (data.needsLink && data.suggestedPrompt && !data.deferLinkPrompt) {
            addMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: data.suggestedPrompt,
              contextType: 'upload_link_prompt',
              contextData: data.uploadContext,
              createdAt: new Date().toISOString(),
            })
          }
          const confirmation = uploadIntentConfirmation(uploadIntent, data.documents)
          if (confirmation) {
            addMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: confirmation.content,
              contextType: confirmation.contextType,
              contextData: confirmation.contextData,
              createdAt: new Date().toISOString(),
            })
          }
          for (const a of previewAttachments) URL.revokeObjectURL(a.url)
          await refreshBusinessContext()

          // Upload success means "file saved". If the user also typed instructions
          // about the upload, give analysis a short head start, but do not let a
          // slow document worker swallow the user's actual request.
          const docsNeedingAnalysis = data.documents.filter(doc => !isInstantProfileUpload(doc))
          const instantProfileDocs = data.documents.filter(isInstantProfileUpload)
          if (instantProfileDocs.length > 0) {
            addMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: instantProfileDocs.some(doc => doc.fileType === 'user_avatar')
                ? 'Saved your profile photo and updated your account avatar.'
                : 'Saved your company logo and updated the company profile.',
              createdAt: new Date().toISOString(),
            })
          }
          if (docsNeedingAnalysis.length > 0) {
            updateMessage(userMessageId, {
              attachments: serverAttachments.map(a => ({
                ...a,
                documentStatus: DOC_BACKGROUND_STATES.has(String(a.documentStatus)) ? 'queued' as const : a.documentStatus,
              })),
            })
            if (!data.needsLink || data.deferLinkPrompt) {
              addMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: text.trim()
                  ? `Saved ${docsNeedingAnalysis.length === 1 ? 'the upload' : `${docsNeedingAnalysis.length} uploads`}. I’m checking the saved analysis now. If it is still processing, I’ll tell you instead of guessing.`
                  : data.deferLinkPrompt && data.suggestedPrompt
                    ? data.suggestedPrompt
                    : `Saved ${docsNeedingAnalysis.length === 1 ? 'the upload' : `${docsNeedingAnalysis.length} uploads`}. I’ll analyze ${docsNeedingAnalysis.length === 1 ? 'it' : 'them'} in the background, so you can keep working.`,
                createdAt: new Date().toISOString(),
              })
            }

            if (text.trim()) {
              setTyping(true)
              setStreaming(true)
              setStreamingText('Analyzing uploaded file...')
              const results: DocumentPollResult[] = []
              for (const doc of docsNeedingAnalysis) {
                if (abortRef.current || abortControllerRef.current.signal.aborted) break
                const result = await pollDocumentStatus(doc.id, userMessageId, false, 6, abortControllerRef.current.signal)
                results.push(result)
              }
              if (abortRef.current || abortControllerRef.current.signal.aborted) return { ok: false }
              const unfinished = results.filter(r => !r.reviewed)
              if (unfinished.length > 0) {
                const timedOut = unfinished.some(r => !r.terminal || r.status === 'timeout')
                addMessage({
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: timedOut
                    ? `The file is saved. Analysis is still finishing, but I’ll continue with your request using the saved file record and I’ll tell you honestly if the extracted data is not ready yet.`
                    : `The file is saved. Analysis finished with status: ${unfinished.map(r => r.status || 'unknown').join(', ')}. I’ll continue with your request using the saved file record and only claim extracted details if they are available.`,
                  createdAt: new Date().toISOString(),
                })
                setStreamingText('Checking saved upload...')
              }
            } else {
              void (async () => {
                for (const doc of docsNeedingAnalysis) {
                  await pollDocumentStatus(doc.id, userMessageId, true)
                }
              })().catch(err => console.error('[use-chat] background document polling:', err))
            }
          }
          if (data.failures.length > 0) {
            addMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `I saved ${data.documents.length} file${data.documents.length === 1 ? '' : 's'}, but ${data.failures.length} failed:\n${data.failures.map(f => `• ${f.fileName}: ${f.error}`).join('\n')}`,
              createdAt: new Date().toISOString(),
            })
          }

          if (!text.trim()) {
            clearUploadProgress()
            return { ok: true }
          }
      } catch (err) {
        if (abortRef.current) return
        console.error('[use-chat] upload:', err)
        clearUploadProgress()
        // Show error to user
        addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `I couldn't upload your file(s). Please try again.`,
          createdAt: new Date().toISOString(),
        })
        return { ok: false, keepAttachments: true }
      }
    }

    const fullMessage = text  // worker injects document IDs separately
    const history = store.messages
      .filter(m => m.id !== userMessageId)
      .slice(-20)
      .filter(m => m.role === 'user' || m.role === 'assistant')
    const serializedHistory = serializeMessagesForAgentHistory(history)

    setTyping(true); setStreaming(true); setStreamingText('Starting...')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          message: fullMessage,
          displayMessage: visibleText,
          conversationId: activeConversationId,
          businessContext: useChatStore.getState().businessContext,
          documentIds: uploadedDocIds,
          history: serializedHistory,
        }),
      })
      if (!res.ok) throw new Error(res.status === 502 ? 'Server took too long. Try again.' : `HTTP ${res.status}`)
      const { jobId } = await res.json()
      if (!jobId) throw new Error('No jobId')
      currentJobIdRef.current = jobId
      let thinkingSteps: any[] = []
      let lastCount = 0
      // First poll immediately, then every 1.5s
      let firstPoll = true
      while (!abortRef.current) {
        if (!firstPoll) await new Promise(r => setTimeout(r, 1500))
        firstPoll = false
        if (abortRef.current) break
        const pollRes = await fetch(`/api/chat/status?jobId=${jobId}`)
        if (!pollRes.ok) continue
        const data = await pollRes.json()
        if (data.heartbeat) setStreamingText(data.heartbeat)
        if (data.thinking?.length > lastCount) {
          thinkingSteps = data.thinking
          lastCount = data.thinking.length
          const last = data.thinking[data.thinking.length - 1]
          if (last?.text) setStreamingText(last.text)
        }
        if (data.status === 'done') {
          const result = data.result || {}
          addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: result.text || '(no response)',
            contextType: result.contextType ?? undefined,
            contextData: result.contextData ?? undefined,
            actionResults: result.actionResults || [],
            attachments: result.attachments?.length > 0 ? result.attachments : undefined,
            thinking: thinkingSteps.length > 0 ? thinkingSteps : undefined,
            createdAt: new Date().toISOString(),
          })
          if (result.conversationId && result.conversationId !== activeConversationId) {
            store.setConversationId(result.conversationId)
          }
          try {
            const [cr, dataRes] = await Promise.all([
              fetch('/api/conversations').catch(() => null),
              fetch('/api/data').catch(() => null),
            ])
            if (cr?.ok) {
              const cd = await cr.json()
              setConversations(cd.conversations || [])
            }
            if (dataRes?.ok) {
              const data = await dataRes.json()
              if (Array.isArray(data.workspaces)) setWorkspaces(data.workspaces)
              if (data.businessContext) useChatStore.getState().setBusinessContext?.(data.businessContext)
            }
          } catch {}
          break
        }
        if (data.status === 'error') throw new Error(data.error || 'Failed')
        if (data.status === 'cancelled') break
      }
    } catch (err) {
      if (abortRef.current) return
      console.error('[use-chat]:', err)
      const e = err instanceof Error ? err.message : String(err)
      // Show friendly error messages for common failures
      let friendlyMsg: string
      if (e.includes('429') || e.includes('rate') || e.includes('Too many requests')) {
        friendlyMsg = "I'm getting too many requests right now. Please wait a few seconds and try again."
      } else if (e.includes('502') || e.includes('timeout')) {
        friendlyMsg = "The server took too long to respond. Please try again."
      } else if (e.includes('Failed to fetch') || e.includes('NetworkError')) {
        friendlyMsg = "Network error — please check your connection and try again."
      } else {
        friendlyMsg = `Something went wrong: ${e}`
      }
      addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: friendlyMsg,
        createdAt: new Date().toISOString(),
      })
    } finally {
      currentJobIdRef.current = null
      abortControllerRef.current = null
      setTyping(false); setStreaming(false); clearStreamingText(); clearUploadProgress(); abortRef.current = false
    }
    return { ok: true }
  }, [addMessage, updateMessage, setTyping, setStreaming, setStreamingText, clearStreamingText, setConversations, setWorkspaces, refreshBusinessContext, clearUploadProgress])

  return { sendMessage, stopMessage }
}
