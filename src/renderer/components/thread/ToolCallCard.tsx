import React, { useState } from 'react'
import type { ToolCallInfo } from '@shared/types/session'
import { Badge } from '../common/Badge'

function formatInput(input: string): string {
  try {
    const parsed = JSON.parse(input)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return input
  }
}

interface ToolCallCardProps {
  toolCall: ToolCallInfo
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const statusColors: Record<string, 'default' | 'accent' | 'success' | 'error' | 'warning'> = {
    pending: 'default',
    in_progress: 'accent',
    running: 'accent',
    completed: 'success',
    failed: 'error'
  }

  const statusIcons: Record<string, React.ReactNode> = {
    pending: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    in_progress: (
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
    running: (
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
    completed: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    failed: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors"
      >
        {statusIcons[toolCall.status]}
        <span className="font-mono font-medium text-text-primary">{toolCall.name}</span>
        <span className="text-text-muted truncate flex-1 text-left">{toolCall.title}</span>
        <Badge variant={statusColors[toolCall.status] || 'default'}>
          {toolCall.status}
        </Badge>
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
        <div className="border-t border-border px-3 py-2 space-y-2">
          {toolCall.diff && (
            <div>
              <div className="text-[10px] text-text-muted uppercase font-medium mb-1">
                {toolCall.diff.path}
              </div>
              <pre className="text-xs font-mono bg-surface-2 rounded p-2 overflow-x-auto text-text-secondary max-h-60 whitespace-pre-wrap">
                {toolCall.diff.newText}
              </pre>
            </div>
          )}
          {toolCall.input && toolCall.input !== '{}' && (
            <div>
              <div className="text-[10px] text-text-muted uppercase font-medium mb-1">Input</div>
              <pre className="text-xs font-mono bg-surface-2 rounded p-2 overflow-x-auto text-text-secondary max-h-40 whitespace-pre-wrap">
                {formatInput(toolCall.input)}
              </pre>
            </div>
          )}
          {toolCall.output && (
            <div>
              <div className="text-[10px] text-text-muted uppercase font-medium mb-1">Output</div>
              <pre className="text-xs font-mono bg-surface-2 rounded p-2 overflow-x-auto text-text-secondary max-h-40 whitespace-pre-wrap">
                {toolCall.output}
              </pre>
            </div>
          )}
          {!toolCall.diff && !toolCall.input && !toolCall.output && (
            <div className="text-xs text-text-muted py-1">No details available</div>
          )}
        </div>
      )}
    </div>
  )
}
