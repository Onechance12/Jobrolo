'use client'
import { useCallback, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import type { ClientMessage, MessageAttachment } from '@/lib/types'

// Terminal states — once a document reaches one of these, we stop polling.
const DOC_TERMINAL_STATES = new Set(['reviewed', 'failed', 'needs_ocr', 'needs_review'])
const DOC_BACKGROUND_STATES = new Set(['queued', 'processing', 'pending_review'])

async function pollDocumentStatus(docId: string, userMessageId: string): Promise<boolean> {
  for (let i = 0; i < 60; i++) { // 60 * 2s = 120s max wait
    await new Promise(r => setTimeout(r, 2000))
    try {
      const res = await fetch(`/api/documents/${docId}`); if (!res.ok) continue
      const data = await res.json()
      const doc = data.document
      if (!doc) return false
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
        // 'reviewed' is success; 'failed' and 'needs_ocr' are terminal but not success
        return doc.status === 'reviewed'
      }
    } catch {}
  }
  return false
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
  const abortRef = useRef(false)

  const sendMessage = useCallback(async ({ text, attachments = [] }: { text: string; attachments?: File[] }) => {
    if (!text.trim() && attachments.length === 0) return
    abortRef.current = false
    const store = useChatStore.getState()
    let activeConversationId = store.conversationId
    if (!activeConversationId) {
      try {
        const r = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 60) || 'New Chat' }),
        })
        if (r.ok) {
          const d = await r.json()
          activeConversationId = d.conversation.id as string
          store.setConversationId(activeConversationId)
          store.createConversationLocally(activeConversationId, text.slice(0, 60))
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
    const userMessageId = crypto.randomUUID()
    addMessage({ id: userMessageId, role: 'user', content: text, attachments: previewAttachments, createdAt: new Date().toISOString() })

    let uploadedDocIds: string[] = []
    let serverAttachments: MessageAttachment[] = []
    if (attachments.length > 0) {
      try {
        const formData = new FormData()
        for (const f of attachments) formData.append('files', f)
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })

        // If upload failed entirely, show error and abort — don't send an empty chat message
        if (!uploadRes.ok) {
          let errMsg = `Upload failed (HTTP ${uploadRes.status})`
          try {
            const errData = await uploadRes.json()
            if (errData.error) errMsg = errData.error
          } catch {}
          console.error('[use-chat] upload failed:', errMsg)
          // Update the user message to show the error
          updateMessage(userMessageId, { content: `${text}\n\n⚠️ Upload failed: ${errMsg}` })
          // Add an assistant message explaining the failure
          addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `I couldn't process your file upload: ${errMsg}\n\nPlease try uploading the file again. If the problem persists, the file type may not be supported.`,
            createdAt: new Date().toISOString(),
          })
          clearUploadProgress()
          return  // ← ABORT — don't send the chat message
        }

        const data = await uploadRes.json()
        uploadedDocIds = (data.documents || []).map((d: any) => d.id)
        serverAttachments = (data.documents || []).map((d: any) => ({
          type: d.fileType === 'photo' ? 'image' : 'file',
          name: d.originalName,
          url: d.url,
          thumbnailUrl: d.thumbnailUrl ?? undefined,
          mimeType: d.mimeType || (d.fileType === 'photo' ? 'image/jpeg' : 'application/octet-stream'),
          size: d.size,
          documentId: d.id,
          documentStatus: d.status,
          documentType: d.fileType,
        }))
          updateMessage(userMessageId, { attachments: serverAttachments })
          for (const doc of (data.documents || [])) {
            if (doc.locationResolution) {
              addMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: doc.locationResolution.confidenceLabel === 'high'
                  ? `I matched ${doc.originalName} to the most likely job-site location.`
                  : `I found a possible job-site match for ${doc.originalName}. Please confirm before attaching it.`,
                contextType: 'location_confirmation',
                contextData: { ...doc.locationResolution, documentId: doc.id, cardType: 'location_confirmation' },
                createdAt: new Date().toISOString(),
              })
            }
          }
          if (data.needsLink && data.suggestedPrompt) {
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
          await refreshBusinessContext()

          // Upload success means "file saved". Analysis is intentionally background work.
          // Do not block the user's chat turn while OCR/AI processing catches up.
          const docsNeedingAnalysis = data.documents || []
          if (docsNeedingAnalysis.length > 0) {
            updateMessage(userMessageId, {
              attachments: serverAttachments.map(a => ({
                ...a,
                documentStatus: DOC_BACKGROUND_STATES.has(String(a.documentStatus)) ? 'queued' as const : a.documentStatus,
              })),
            })
            if (!data.needsLink) {
              addMessage({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `Saved ${docsNeedingAnalysis.length === 1 ? 'the upload' : `${docsNeedingAnalysis.length} uploads`}. I’ll analyze ${docsNeedingAnalysis.length === 1 ? 'it' : 'them'} in the background, so you can keep working.`,
                createdAt: new Date().toISOString(),
              })
            }

            void (async () => {
              for (const doc of docsNeedingAnalysis) {
                await pollDocumentStatus(doc.id, userMessageId)
              }
            })().catch(err => console.error('[use-chat] background document polling:', err))
          }
      } catch (err) {
        console.error('[use-chat] upload:', err)
        clearUploadProgress()
        // Show error to user
        addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `I couldn't upload your file(s). Please try again.`,
          createdAt: new Date().toISOString(),
        })
        return  // ← ABORT
      }
    }

    const fullMessage = text  // worker injects document IDs separately
    const history = store.messages
      .filter(m => m.id !== userMessageId)
      .slice(-20)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    setTyping(true); setStreaming(true); setStreamingText('Starting...')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullMessage,
          conversationId: activeConversationId,
          businessContext: useChatStore.getState().businessContext,
          documentIds: uploadedDocIds,
          history,
        }),
      })
      if (!res.ok) throw new Error(res.status === 502 ? 'Server took too long. Try again.' : `HTTP ${res.status}`)
      const { jobId } = await res.json()
      if (!jobId) throw new Error('No jobId')
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
            const cr = await fetch('/api/conversations')
            if (cr.ok) {
              const cd = await cr.json()
              setConversations(cd.conversations || [])
            }
          } catch {}
          break
        }
        if (data.status === 'error') throw new Error(data.error || 'Failed')
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
      setTyping(false); setStreaming(false); clearStreamingText(); clearUploadProgress(); abortRef.current = false
    }
  }, [addMessage, updateMessage, setTyping, setStreaming, setStreamingText, clearStreamingText, setConversations, refreshBusinessContext, clearUploadProgress])

  return { sendMessage }
}
