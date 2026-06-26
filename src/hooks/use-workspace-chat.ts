'use client'
import { useCallback, useRef } from 'react'
import { useWorkspaceStore } from '@/store/workspace-store'
import type { ClientMessage, MessageAttachment } from '@/lib/types'

// Terminal states — once a document reaches one of these, we stop polling.
const DOC_TERMINAL_STATES = new Set(['reviewed', 'failed', 'needs_ocr', 'needs_review'])

async function pollDoc(docId: string, userMessageId: string): Promise<boolean> {
  for (let i = 0; i < 60; i++) { // 60 * 2s = 120s max wait
    await new Promise(r => setTimeout(r, 2000))
    try {
      const res = await fetch(`/api/documents/${docId}`)
      if (!res.ok) continue
      const d = await res.json()
      const doc = d.document
      if (!doc) return false
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
        return doc.status === 'reviewed'
      }
    } catch {}
  }
  return false
}

export function useWorkspaceChat() {
  const addMessage = useWorkspaceStore(s => s.addMessage)
  const updateLastMessage = useWorkspaceStore(s => s.updateLastMessage)
  const setTyping = useWorkspaceStore(s => s.setTyping)
  const setStreamingText = useWorkspaceStore(s => s.setStreamingText)
  const clearStreamingText = useWorkspaceStore(s => s.clearStreamingText)
  const abortRef = useRef(false)

  const sendWorkspaceMessage = useCallback(async ({ text, attachments = [] }: { text: string; attachments?: File[] }) => {
    if (!text.trim() && attachments.length === 0) return
    abortRef.current = false
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
    addMessage({ id: userMessageId, role: 'user', content: text, attachments: previewAttachments, createdAt: new Date().toISOString() })

    let uploadedDocIds: string[] = []
    let serverAttachments: MessageAttachment[] = []
    if (attachments.length > 0) {
      try {
        const fd = new FormData()
        for (const f of attachments) fd.append('files', f)
        fd.append('workspaceId', workspaceId)
        const ws = store.getCurrentWorkspace()
        if (ws?.projectId) fd.append('projectId', ws.projectId)
        const ur = await fetch('/api/upload', { method: 'POST', body: fd })

        // If upload failed, show error and abort
        if (!ur.ok) {
          let errMsg = `Upload failed (HTTP ${ur.status})`
          try { const e = await ur.json(); if (e.error) errMsg = e.error } catch {}
          addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `I couldn't process your file upload: ${errMsg}. Please try again.`,
            createdAt: new Date().toISOString(),
          })
          return  // ABORT
        }

        const d = await ur.json()
          uploadedDocIds = (d.documents || []).map((x: any) => x.id)
          serverAttachments = (d.documents || []).map((x: any) => ({
            type: x.fileType === 'photo' ? 'image' : 'file',
            name: x.originalName,
            url: x.url,
            thumbnailUrl: x.thumbnailUrl ?? undefined,
            mimeType: x.mimeType || (x.fileType === 'photo' ? 'image/jpeg' : 'application/octet-stream'),
            size: x.size,
            documentId: x.id,
            documentStatus: x.status,
            documentType: x.fileType,
          }))
          updateLastMessage({ attachments: serverAttachments })
          for (const doc of (d.documents || [])) {
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
          if (d.needsLink && d.suggestedPrompt) {
            addMessage({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: d.suggestedPrompt,
              contextType: 'upload_link_prompt',
              contextData: d.uploadContext,
              createdAt: new Date().toISOString(),
            })
          }
          for (const a of previewAttachments) URL.revokeObjectURL(a.url)

          // Wait for ALL documents (including photos) to reach a terminal state.
          const docs = d.documents || []
          if (docs.length > 0) {
            updateLastMessage({
              attachments: serverAttachments.map(a => ({ ...a, documentStatus: 'processing' as const })),
            })
            setTyping(true)
            setStreamingText('Analyzing document...')
            for (const doc of docs) await pollDoc(doc.id, userMessageId)
            setTyping(false)
            setStreamingText('')
          }
      } catch (e) {
        console.error('[ws-chat] upload:', e)
        addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `I couldn't upload your file(s). Please try again.`,
          createdAt: new Date().toISOString(),
        })
        return  // ABORT
      }
    }

    const fullMsg = text  // worker injects document IDs separately
    const freshState = useWorkspaceStore.getState()
    const history = freshState.messages
      .filter(m => m.id !== userMessageId)
      .slice(-20)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    setTyping(true); setStreamingText('Starting...')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message: fullMsg, documentIds: uploadedDocIds, history }),
      })
      if (!res.ok) throw new Error(res.status === 502 ? 'Server took too long.' : `HTTP ${res.status}`)
      const { jobId } = await res.json()
      if (!jobId) throw new Error('No jobId')
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
          break
        }
        if (data.status === 'error') throw new Error(data.error || 'Failed')
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
      setTyping(false); clearStreamingText(); abortRef.current = false
    }
  }, [addMessage, updateLastMessage, setTyping, setStreamingText, clearStreamingText])

  return { sendWorkspaceMessage }
}
