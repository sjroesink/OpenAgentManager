import React, { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Message, ContentBlock, PermissionRequestEvent, ToolCallInfo } from '@shared/types/session'
import { ToolCallCard } from './ToolCallCard'
import { useSessionStore } from '../../stores/session-store'

interface MessageBubbleProps {
  message: Message
  sessionId: string
  workingDir: string
}

function renderContentBlock(block: ContentBlock, isUser: boolean, index: number): React.ReactNode {
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

  return null
}

interface ToolCallGroupProps {
  toolCalls: ToolCallInfo[]
  workingDir: string
  pendingPermissionsByToolCallId: Map<string, PermissionRequestEvent>
  onPermissionRespond: (requestId: string, optionId: string) => void
}

function ToolCallGroup({
  toolCalls,
  workingDir,
  pendingPermissionsByToolCallId,
  onPermissionRespond
}: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const doneCount = toolCalls.filter((toolCall) => toolCall.status === 'completed').length
  const runningCount = toolCalls.filter(
    (toolCall) => toolCall.status === 'running' || toolCall.status === 'in_progress'
  ).length
  const failedCount = toolCalls.filter((toolCall) => toolCall.status === 'failed').length

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface-1">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors"
      >
        <span className="text-text-primary font-medium">Tool calls ({toolCalls.length})</span>
        <span className="text-text-muted">Done {doneCount}</span>
        {runningCount > 0 && <span className="text-accent">Working {runningCount}</span>}
        {failedCount > 0 && <span className="text-error">Failed {failedCount}</span>}
        <div className="flex-1" />
        <svg
          className={`w-3 h-3 transition-transform text-text-muted ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2">
          <div className="border-l border-border/70 pl-2 space-y-1.5">
            {toolCalls.map((toolCall) => (
              <ToolCallCard
                key={toolCall.toolCallId}
                toolCall={toolCall}
                workingDir={workingDir}
                permissionRequest={pendingPermissionsByToolCallId.get(toolCall.toolCallId)}
                onPermissionRespond={onPermissionRespond}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type MessageSegment =
  | { type: 'content'; key: string; block: ContentBlock; index: number }
  | { type: 'tool_group'; key: string; toolCallIds: string[] }

function isToolCallRefBlock(block: ContentBlock): block is Extract<ContentBlock, { type: 'tool_call_ref' }> {
  return block.type === 'tool_call_ref'
}

function buildMessageSegments(content: ContentBlock[]): MessageSegment[] {
  const segments: MessageSegment[] = []
  let index = 0

  while (index < content.length) {
    const block = content[index]

    if (!isToolCallRefBlock(block)) {
      segments.push({ type: 'content', key: `content-${index}`, block, index })
      index += 1
      continue
    }

    const toolCallIds: string[] = []
    let groupIndex = index
    while (groupIndex < content.length) {
      const toolCallRef = content[groupIndex]
      if (!isToolCallRefBlock(toolCallRef)) break
      toolCallIds.push(toolCallRef.toolCallId)
      groupIndex += 1
    }

    segments.push({ type: 'tool_group', key: `tool-group-${index}`, toolCallIds })
    index = groupIndex
  }

  return segments
}

export function MessageBubble({ message, sessionId, workingDir }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const pendingPermissions = useSessionStore((s) => s.pendingPermissions)
  const respondToPermission = useSessionStore((s) => s.respondToPermission)

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
  const pendingPermissionsByToolCallId = new Map(
    pendingPermissions
      .filter((permission) => permission.sessionId === sessionId && !!permission.toolCall.toolCallId)
      .map((permission) => [permission.toolCall.toolCallId, permission])
  )
  const messageSegments = useMemo(() => buildMessageSegments(message.content), [message.content])

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
        {messageSegments.map((segment) => {
          if (segment.type === 'content') {
            return renderContentBlock(segment.block, isUser, segment.index)
          }

          const toolCalls = segment.toolCallIds
            .map((toolCallId) => toolCallMap.get(toolCallId))
            .filter((toolCall): toolCall is ToolCallInfo => !!toolCall)
          if (toolCalls.length === 0) return null

          if (toolCalls.length === 1) {
            const toolCall = toolCalls[0]
            return (
              <div key={segment.key} className="my-1.5">
                <ToolCallCard
                  toolCall={toolCall}
                  workingDir={workingDir}
                  permissionRequest={pendingPermissionsByToolCallId.get(toolCall.toolCallId)}
                  onPermissionRespond={respondToPermission}
                />
              </div>
            )
          }

          return (
            <div key={segment.key} className="my-1.5">
              <ToolCallGroup
                toolCalls={toolCalls}
                workingDir={workingDir}
                pendingPermissionsByToolCallId={pendingPermissionsByToolCallId}
                onPermissionRespond={respondToPermission}
              />
            </div>
          )
        })}

        {/* Fallback: render unreferenced tool calls at the end (legacy messages without refs) */}
        {unreferencedToolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {unreferencedToolCalls.map((tc) => (
              <ToolCallCard
                key={tc.toolCallId}
                toolCall={tc}
                workingDir={workingDir}
                permissionRequest={pendingPermissionsByToolCallId.get(tc.toolCallId)}
                onPermissionRespond={respondToPermission}
              />
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
