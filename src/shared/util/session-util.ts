import type { ContentBlock, Message, SessionUpdate, ToolCallStatus } from '@shared/types/session'
import { v4 as uuid } from 'uuid'

/**
 * Updates a list of messages based on a SessionUpdate.
 * Returns a new array (immutable update).
 */
export function applyUpdateToMessages(messages: Message[], update: SessionUpdate): Message[] {
  switch (update.type) {
    case 'message_start': {
      const hasOpenStreamingAgent = messages.some(
        (m) => m.role === 'agent' && m.isStreaming
      )
      if (update.messageId === 'current' && hasOpenStreamingAgent) {
        return messages
      }
      const hasExplicitMessage = update.messageId !== 'current' && messages.some(
        (m) => m.id === update.messageId
      )
      if (hasExplicitMessage) {
        return messages
      }
      const newMsg: Message = {
        id: update.messageId === 'current' ? uuid() : update.messageId,
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
        const lastBlock = msg.content.length > 0 ? msg.content[msg.content.length - 1] : null
        if (lastBlock && lastBlock.type === 'thinking') {
          const newContent = [...msg.content]
          newContent[newContent.length - 1] = { type: 'thinking', text: lastBlock.text + update.text }
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
      let didUpdateById = false
      const updatedById = messages.map((msg) => {
        if (!msg.toolCalls) return msg
        const tcIdx = msg.toolCalls.findIndex((t) => t.toolCallId === update.toolCallId)
        if (tcIdx < 0) return msg
        didUpdateById = true
        const newToolCalls = [...msg.toolCalls]
        newToolCalls[tcIdx] = {
          ...newToolCalls[tcIdx],
          status: update.status,
          ...(update.output != null ? { output: update.output } : {}),
          ...(update.locations ? { locations: update.locations } : {})
        }
        return { ...msg, toolCalls: newToolCalls }
      })
      if (didUpdateById) return updatedById

      // Some agents emit tool_call_update without a stable toolCallId.
      // Fallback: if we can uniquely identify a single open tool call, update that one.
      const openToolCalls: Array<{ messageIndex: number; toolCallIndex: number }> = []
      for (let mi = 0; mi < messages.length; mi++) {
        const toolCalls = messages[mi].toolCalls
        if (!toolCalls) continue
        for (let ti = 0; ti < toolCalls.length; ti++) {
          if (isOpenToolCallStatus(toolCalls[ti].status)) {
            openToolCalls.push({ messageIndex: mi, toolCallIndex: ti })
          }
        }
      }
      if (openToolCalls.length !== 1) return messages

      const [{ messageIndex, toolCallIndex }] = openToolCalls
      return messages.map((msg, mi) => {
        if (mi !== messageIndex || !msg.toolCalls) return msg
        const newToolCalls = [...msg.toolCalls]
        newToolCalls[toolCallIndex] = {
          ...newToolCalls[toolCallIndex],
          status: update.status,
          ...(update.output != null ? { output: update.output } : {}),
          ...(update.locations ? { locations: update.locations } : {})
        }
        return { ...msg, toolCalls: newToolCalls }
      })
    }

    case 'message_complete': {
      return messages.map((m) =>
        (m.id === update.messageId || m.isStreaming)
          ? {
              ...m,
              isStreaming: false,
              toolCalls: m.toolCalls?.map((tc) =>
                ({
                  ...tc,
                  status:
                    tc.status === 'pending' || tc.status === 'in_progress' || tc.status === 'running'
                      ? ('completed' as const)
                      : tc.status
                })
              )
            }
          : m
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
  // Search the entire thread for an exact message ID match.
  // This ensures streaming chunks are always routed to the correct message,
  // even if the user sends another message before the agent finishes responding.
  let idx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id === messageId) {
      idx = i
      break
    }
  }

  // Fall back to the latest streaming agent message.
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'agent' && messages[i].isStreaming) {
        idx = i
        break
      }
    }
  }

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
    timestamp: new Date().toISOString(),
    isStreaming: true
  })
  return [...messages, newMsg]
}

function isOpenToolCallStatus(status: ToolCallStatus): boolean {
  return status === 'pending' || status === 'in_progress' || status === 'running'
}

