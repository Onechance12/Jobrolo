import type { ClientMessage } from '@/lib/types'

function safeJson(value: unknown, max = 1200) {
  try {
    return JSON.stringify(value).slice(0, max)
  } catch {
    return ''
  }
}

function quoted(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function serializeMessageForAgentHistory(message: ClientMessage) {
  const parts = [message.content || '']

  if (message.attachments?.length) {
    const attachmentLines = message.attachments.map((attachment, index) => {
      const details = [
        `#${index + 1}`,
        attachment.name ? `name=${quoted(attachment.name)}` : null,
        attachment.documentId ? `documentId=${quoted(attachment.documentId)}` : null,
        attachment.documentStatus ? `status=${quoted(attachment.documentStatus)}` : null,
        attachment.documentCategory ? `category=${quoted(attachment.documentCategory)}` : null,
        attachment.documentType ? `type=${quoted(attachment.documentType)}` : null,
        attachment.documentSummary ? `summary=${quoted(attachment.documentSummary.slice(0, 240))}` : null,
      ].filter(Boolean)
      return `- ${details.join(' | ')}`
    })
    parts.push(`[MESSAGE ATTACHMENTS]\n${attachmentLines.join('\n')}`)
  }

  if (message.contextType && message.contextData) {
    parts.push(`[MESSAGE CARD contextType="${message.contextType}"]\n${safeJson(message.contextData)}`)
  }

  if (message.actionResults?.length) {
    parts.push(`[ACTION RESULTS]\n${safeJson(message.actionResults)}`)
  }

  return parts.filter(Boolean).join('\n\n')
}

export function serializeMessagesForAgentHistory(messages: ClientMessage[]) {
  return messages.map(message => ({
    role: message.role as 'user' | 'assistant',
    content: serializeMessageForAgentHistory(message),
  }))
}
