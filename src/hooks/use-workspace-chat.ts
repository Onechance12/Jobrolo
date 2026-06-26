'use client'
import { useCallback, useRef } from 'react'
import { useWorkspaceStore } from '@/store/workspace-store'
import type { ClientMessage, MessageAttachment } from '@/lib/types'
import { attachmentFromDocument, uploadAnalysisFollowupFromDocument, uploadFilesSequentially } from '@/hooks/chat-upload'
import { serializeMessagesForAgentHistory } from '@/hooks/chat-history'

// Terminal states — once a document reaches one of these, we stop polling.
const DOC_TERMINAL_STATES = new Set(['reviewed', 'failed', 'needs_ocr', 'needs_review'])
const DOC_BACKGROUND_STATES = new Set(['queued', 'processing', 'pending_review'])

type DocumentPollResult = { reviewed: boolean; terminal: boolean; status?: string; doc?: any }

async function pollDoc(docId: string, userMessageId: string, postAnalysisFollowup = false, maxAttempts = 60, signal?: AbortSignal): Promise<DocumentPollResult> {
  for (let i = 0; i < maxAttempts; i++) { // default 60 * 2s = 120s max wait
    if (signal?.aborted) return { reviewed: false, terminal: false, status: 'stopped' }
    await new Promise(r => setTimeout(r, 2000))
    if (signal?.aborted) return { reviewed: false, terminal: false, status: 'stopped' }
    try {
      const res = await fetch(`/api/documents/${docId}`)
      if (!res.ok) continue
      const d = await res.json()
      const doc = d.document
      if (!doc) return { reviewed: false, terminal: true, status: 'missing' }
      if (DOC_TERMINAL_STATES.has(doc.status)) {
        const store = useWorkspaceStore.getState()
        const msg = store.messages.find(m => m.id === userMessageId)
        if (msg?.attachments) {
          const u = msg.attachments.map(a =>
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
          store.updateMessage(userMessageId, { attachments: u })
        }
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
        return { reviewed: doc.status === 'reviewed', terminal: true, status: doc.status, doc }
      }
    } catch {}
  }
  return { reviewed: false, terminal: false, status: 'timeout' }
}

export function useWorkspaceChat() {
  const addMessage = useWorkspaceStore(s => s.addMessage)
  const updateMessage = useWorkspaceStore(s => s.updateMessage)
  const updateLastMessage = useWorkspaceStore(s => s.updateLastMessage)
  const setWorkspaces = useWorkspaceStore(s => s.setWorkspaces)
  const setTyping = useWorkspaceStore(s => s.setTyping)
  const setStreamingText = useWorkspaceStore(s => s.setStreamingText)
  const clearStreamingText = useWorkspaceStore(s => s.clearStreamingText)
  const abortRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentJobIdRef = useRef<string | null>(null)

  const stopWorkspaceMessage = useCallback(async () => {
    abortRef.current = true
    abortControllerRef.current?.abort()
    const jobId = currentJobIdRef.current
    const workspaceId = useWorkspaceStore.getState().currentWorkspaceId
    currentJobIdRef.current = null
    if (jobId && workspaceId) {
      await fetch(`/api/workspaces/${workspaceId}/chat/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(() => null)
    }
    setTyping(false)
    clearStreamingText()
    addMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Stopped. Tell me what you want me to do next.',
      createdAt: new Date().toISOString(),
    })
  }, [addMessage, clearStreamingText, setTyping])

  const sendWorkspaceMessage = useCallback(async ({ text, displayText, attachments = [], uploadFields = {} }: { text: string; displayText?: string; attachments?: File[]; uploadFields?: Record<string, string> }) => {
    if (!text.trim() && attachments.length === 0) return
    const visibleText = displayText ?? text
    abortRef.current = false
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const store = useWorkspaceStore.getState()
    const workspaceId = store.currentWorkspaceId
    const chatId = store.currentChatId
    if (!workspaceId || !chatId) return

    const previewAttachments: MessageAttachment[] = attachments.map(f => ({
      type: f.type.startsWith('image/') ? 'image' : 'file',
      name: f.name,
      url: URL.createObjectURL(f),
      mimeType: f.type,
      size: f.size,
    }))
    const userMessageId = crypto.randomUUID()
    addMessage({ id: userMessageId, role: 'user', content: visibleText, attachments: previewAttachments, createdAt: new Date().toISOString() })

    let uploadedDocIds: string[] = []
    let serverAttachments: MessageAttachment[] = []
    if (attachments.length > 0) {
      try {
        const ws = store.getCurrentWorkspace()
        const data = await uploadFilesSequentially(attachments, {
          signal: abortControllerRef.current.signal,
          fields: {
            workspaceId,
            ...(ws?.projectId ? { projectId: ws.projectId } : {}),
            ...uploadFields,
          },
        })

        if (data.documents.length === 0) {
          const errMsg = data.failures.map(f => `${f.fileName}: ${f.error}`).join('\n') || 'Upload failed before the server responded'
          addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `I couldn't save the upload yet: ${errMsg}. Try one smaller file first.`,
            createdAt: new Date().toISOString(),
          })
          return { ok: false, keepAttachments: true }
        }

          uploadedDocIds = data.documents.map(x => x.id)
          serverAttachments = data.documents.map(attachmentFromDocument)
          updateLastMessage({ attachments: serverAttachments })
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
          for (const a of previewAttachments) URL.revokeObjectURL(a.url)

          // Upload success means "file saved". If the user also typed instructions
          // about the upload, wait for analysis before starting the agent so it
          // doesn't call get_document_content while the file is still processing.
          const docs = data.documents
          if (docs.length > 0) {
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
                  ? `Saved ${docs.length === 1 ? 'the upload' : `${docs.length} uploads`}. I’m finishing the analysis before I answer so I don’t guess from a half-processed file.`
                  : data.deferLinkPrompt && data.suggestedPrompt
                    ? data.suggestedPrompt
                    : `Saved ${docs.length === 1 ? 'the upload' : `${docs.length} uploads`}. I’ll analyze ${docs.length === 1 ? 'it' : 'them'} in the background, so you can keep working.`,
                createdAt: new Date().toISOString(),
              })
            }
            if (text.trim()) {
              setTyping(true)
              setStreamingText('Analyzing uploaded file...')
              const results: DocumentPollResult[] = []
              for (const doc of docs) {
                if (abortRef.current || abortControllerRef.current.signal.aborted) break
                const result = await pollDoc(doc.id, userMessageId, false, 60, abortControllerRef.current.signal)
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
                    ? `The file is saved, but analysis is still running longer than expected. I’m not going to fake an answer from a half-processed document. Try “analyze the uploaded scope” again in a minute, or use the file card once it finishes.`
                    : `The file is saved, but analysis finished with status: ${unfinished.map(r => r.status || 'unknown').join(', ')}. I can still attach the saved file, but I don’t have reliable extracted scope text yet.`,
                  createdAt: new Date().toISOString(),
                })
                setTyping(false)
                clearStreamingText()
                return { ok: false, keepAttachments: true }
              }
            } else {
              void (async () => {
                for (const doc of docs) await pollDoc(doc.id, userMessageId, true)
              })().catch(err => console.error('[ws-chat] background document polling:', err))
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

          if (!text.trim()) return { ok: true }
      } catch (e) {
        if (abortRef.current) return
        console.error('[ws-chat] upload:', e)
        addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `I couldn't upload your file(s). Please try again.`,
          createdAt: new Date().toISOString(),
        })
        return { ok: false, keepAttachments: true }
      }
    }

    const fullMsg = text  // worker injects document IDs separately
    const freshState = useWorkspaceStore.getState()
    const history = freshState.messages
      .filter(m => m.id !== userMessageId)
      .slice(-20)
      .filter(m => m.role === 'user' || m.role === 'assistant')
    const serializedHistory = serializeMessagesForAgentHistory(history)

    setTyping(true); setStreamingText('Starting...')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({ chatId, message: fullMsg, displayMessage: visibleText, documentIds: uploadedDocIds, history: serializedHistory }),
      })
      if (!res.ok) throw new Error(res.status === 502 ? 'Server took too long.' : `HTTP ${res.status}`)
      const { jobId } = await res.json()
      if (!jobId) throw new Error('No jobId')
      currentJobIdRef.current = jobId
      let thinkingSteps: any[] = []
      let lastCount = 0
      while (!abortRef.current) {
        await new Promise(r => setTimeout(r, 1500))
        if (abortRef.current) break
        const pr = await fetch(`/api/workspaces/${workspaceId}/chat/status?jobId=${jobId}`)
        if (!pr.ok) continue
        const data = await pr.json()
        if (data.heartbeat) setStreamingText(data.heartbeat)
        if (data.thinking?.length > lastCount) {
          thinkingSteps = data.thinking
          lastCount = data.thinking.length
          const l = data.thinking[data.thinking.length - 1]
          if (l?.text) setStreamingText(l.text)
        }
        if (data.status === 'done') {
          const r = data.result || {}
          addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: r.text || '(no response)',
            contextType: r.contextType ?? undefined,
            contextData: r.contextData ?? undefined,
            actionResults: r.actionResults || [],
            attachments: r.attachments?.length > 0 ? r.attachments : undefined,
            thinking: thinkingSteps.length > 0 ? thinkingSteps : undefined,
            createdAt: new Date().toISOString(),
          })
          try {
            const dataRes = await fetch('/api/data')
            if (dataRes.ok) {
              const data = await dataRes.json()
              if (Array.isArray(data.workspaces)) setWorkspaces(data.workspaces)
            }
          } catch {}
          break
        }
        if (data.status === 'error') throw new Error(data.error || 'Failed')
        if (data.status === 'cancelled') break
      }
    } catch (err) {
      if (abortRef.current) return
      console.error('[ws-chat]:', err)
      const e = err instanceof Error ? err.message : String(err)
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
      setTyping(false); clearStreamingText(); abortRef.current = false
    }
    return { ok: true }
  }, [addMessage, updateMessage, updateLastMessage, setWorkspaces, setTyping, setStreamingText, clearStreamingText])

  return { sendWorkspaceMessage, stopWorkspaceMessage }
}
