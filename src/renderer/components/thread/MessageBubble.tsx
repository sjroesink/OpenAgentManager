import React from 'react'
import ReactMarkdown from 'react-markdown'
import type { Message, ContentBlock } from '@shared/types/session'
import { ToolCallCard } from './ToolCallCard'

interface MessageBubbleProps {
  message: Message
}

function renderContentBlock(block: ContentBlock, isUser: boolean, toolCallMap: Map<string, unknown>, index: number): React.ReactNode {
  if (block.type === 'text' && block.text) {
    return (
      <div
        key={index}
        className={`
          rounded-xl px-3 py-2 text-sm leading-snug inline-block max-w-full
          ${
            isUser
              ? 'bg-accent text-accent-text rounded-tr-sm'
              : 'bg-surface-2 text-text-primary rounded-tl-sm'
          }
        `}
      >
        <div className={`markdown-body break-words ${isUser ? '' : 'markdown-body-agent'}`}>
          <ReactMarkdown>{block.text}</ReactMarkdown>
        </div>
      </div>
    )
  }

  if (block.type === 'thinking' && block.text) {
    return (
      <div
        key={index}
        className="bg-surface-2/50 border border-border/50 rounded-lg px-3 py-2 text-xs text-text-muted italic mb-2"
      >
        <div className="flex items-center gap-1.5 mb-1 text-text-secondary font-medium not-italic">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Thinking
        </div>
        {block.text}
      </div>
    )
  }

  if (block.type === 'image') {
    const src = block.data ? `data:${block.mimeType};base64,${block.data}` : block.uri
    if (!src) return null
    return (
      <div key={index} className="my-2">
        <img
          src={src}
          alt="User attachment"
          className="max-w-full max-h-64 rounded-lg border border-border"
        />
      </div>
    )
  }

  if (block.type === 'tool_call_ref') {
    const tc = toolCallMap.get(block.toolCallId)
    if (tc) {
      return (
        <div key={index} className="my-1.5">
          <ToolCallCard toolCall={tc as Parameters<typeof ToolCallCard>[0]['toolCall']} />
        </div>
      )
    }
  }

  return null
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  const hasVisibleContent =
    message.content.some((b) => (b.type === 'text' || b.type === 'thinking') && b.text) ||
    message.content.some((b) => b.type === 'image') ||
    (message.toolCalls && message.toolCalls.length > 0) ||
    message.isStreaming

  // Don't render empty agent bubbles (e.g. from empty session update chunks)
  if (!isUser && !hasVisibleContent) return null

  // Build a lookup map for tool calls by ID
  const toolCallMap = new Map(
    (message.toolCalls || []).map((tc) => [tc.toolCallId, tc])
  )

  // Check if content has tool_call_ref blocks (new ordered format)
  const hasToolCallRefs = message.content.some((b) => b.type === 'tool_call_ref')

  // Collect tool calls that don't have a ref in content (legacy messages)
  const unreferencedToolCalls = hasToolCallRefs
    ? (message.toolCalls || []).filter(
        (tc) => !message.content.some((b) => b.type === 'tool_call_ref' && b.toolCallId === tc.toolCallId)
      )
    : message.toolCalls || []

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`
          w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0
          ${isUser ? 'bg-accent text-accent-text' : 'bg-surface-3 text-text-secondary'}
        `}
      >
        {isUser ? 'U' : 'A'}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
        {/* Interleaved content: text, thinking, images, and tool calls in order */}
        {message.content.map((block, i) => renderContentBlock(block, isUser, toolCallMap, i))}

        {/* Fallback: render unreferenced tool calls at the end (legacy messages without refs) */}
        {unreferencedToolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {unreferencedToolCalls.map((tc) => (
              <ToolCallCard key={tc.toolCallId} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Streaming indicator */}
        {message.isStreaming && (
          <span className="inline-block w-2 h-4 bg-accent animate-pulse rounded-sm ml-1" />
        )}

        {/* Timestamp */}
        <div className="text-[10px] text-text-muted mt-1 px-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}
