import type { Message, SessionUpdate, ContentBlock, ToolCallInfo } from '../types/session'
import { v4 as uuid } from 'uuid'

/**
 * Updates a list of messages based on a SessionUpdate.
 * Returns a new array (immutable update).
 */
export function applyUpdateToMessages(messages: Message[], update: SessionUpdate): Message[] {
  switch (update.type) {
    case 'message_start': {
      const newMsg: Message = {
        id: update.messageId,
        role: 'agent',
        content: [],
        timestamp: new Date().toISOString(),
        isStreaming: true
      }
      return [...messages, newMsg]
    }

    case 'text_chunk': {
      if (!update.text) return messages
      return replaceAgentMessage(messages, update.messageId, (msg) => {
        // Find the last content block
        const lastBlock = msg.content.length > 0 ? msg.content[msg.content.length - 1] : null
        // If the last block is a text block, append to it
        if (lastBlock && lastBlock.type === 'text') {
          const newContent = [...msg.content]
          newContent[newContent.length - 1] = { type: 'text', text: lastBlock.text + update.text }
          return { ...msg, content: newContent }
        }
        // Otherwise start a new text block (e.g. after a tool_call_ref or thinking block)
        return { ...msg, content: [...msg.content, { type: 'text', text: update.text }] }
      })
    }

    case 'thinking_chunk': {
      if (!update.text) return messages
      return replaceAgentMessage(messages, update.messageId, (msg) => {
        const lastIdx = findLastIndex(msg.content, (b) => b.type === 'thinking')
        if (lastIdx >= 0) {
          const block = msg.content[lastIdx] as { type: 'thinking'; text: string }
          const newContent = [...msg.content]
          newContent[lastIdx] = { type: 'thinking', text: block.text + update.text }
          return { ...msg, content: newContent }
        }
        return { ...msg, content: [...msg.content, { type: 'thinking', text: update.text }] }
      })
    }

    case 'tool_call_start': {
      return replaceAgentMessage(messages, update.messageId, (msg) => {
        const existing = (msg.toolCalls || []).findIndex(
          (t) => t.toolCallId === update.toolCall.toolCallId
        )
        if (existing >= 0) {
          const newToolCalls = [...msg.toolCalls!]
          newToolCalls[existing] = { ...newToolCalls[existing], ...update.toolCall }
          return { ...msg, toolCalls: newToolCalls }
        }
        // Add tool call to toolCalls array AND a ref in content for ordering
        const ref: ContentBlock = { type: 'tool_call_ref', toolCallId: update.toolCall.toolCallId }
        return {
          ...msg,
          content: [...msg.content, ref],
          toolCalls: [...(msg.toolCalls || []), update.toolCall]
        }
      })
    }

    case 'tool_call_update': {
      return messages.map((msg) => {
        if (!msg.toolCalls) return msg
        const tcIdx = msg.toolCalls.findIndex((t) => t.toolCallId === update.toolCallId)
        if (tcIdx < 0) return msg
        const newToolCalls = [...msg.toolCalls]
        newToolCalls[tcIdx] = {
          ...newToolCalls[tcIdx],
          status: update.status,
          ...(update.output != null ? { output: update.output } : {}),
          ...(update.locations ? { locations: update.locations } : {})
        }
        return { ...msg, toolCalls: newToolCalls }
      })
    }

    case 'message_complete': {
      return messages.map((m) =>
        (m.id === update.messageId || m.isStreaming) ? { ...m, isStreaming: false } : m
      )
    }

    default:
      return messages
  }
}

function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i
  }
  return -1
}

function replaceAgentMessage(
  messages: Message[],
  messageId: string,
  transform: (msg: Message) => Message
): Message[] {
  const lastUserIdx = findLastIndex(messages, (m) => m.role === 'user')

  const idx = messages.findIndex((m, i) =>
    i > lastUserIdx && (m.id === messageId || (messageId === 'current' && m.role === 'agent'))
  )

  if (idx >= 0) {
    const newMessages = [...messages]
    newMessages[idx] = transform(messages[idx])
    return newMessages
  }

  // No matching agent message found — create one.
  // This handles agents that don't send message_start before streaming chunks.
  const newMsg = transform({
    id: messageId === 'current' ? uuid() : messageId,
    role: 'agent',
    content: [],
    timestamp: new Date().toISOString()
  })
  return [...messages, newMsg]
}
