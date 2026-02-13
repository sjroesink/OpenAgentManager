import React from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useProjectStore } from '../../stores/project-store'
import { ThreadView } from '../thread/ThreadView'
import { PromptInput } from '../thread/PromptInput'
import { Button } from '../common/Button'
import { useUiStore } from '../../stores/ui-store'

export function MainPanel() {
  const { activeSessionId, getActiveSession } = useSessionStore()
  const project = useProjectStore((s) => s.project)
  const setRegistryBrowserOpen = useUiStore((s) => s.setRegistryBrowserOpen)
  const activeSession = getActiveSession()

  if (!activeSession) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-4">
        <svg className="w-16 h-16 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <div className="text-center">
          <p className="text-lg font-medium text-text-secondary mb-1">No active session</p>
          <p className="text-sm">
            {project
              ? 'Create a new thread to start working with an agent'
              : 'Open a project to get started'}
          </p>
        </div>
        {!project && (
          <Button variant="primary" onClick={() => useProjectStore.getState().selectDirectory()}>
            Open Project
          </Button>
        )}
        {project && (
          <Button variant="primary" onClick={() => setRegistryBrowserOpen(true)}>
            Install an Agent
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Session header */}
      <div className="flex items-center px-4 py-2 border-b border-border gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-success shrink-0" />
          <span className="text-sm font-medium truncate">{activeSession.agentName}</span>
          <span className="text-xs text-text-muted truncate">{activeSession.title}</span>
        </div>
        <div className="flex-1" />
        {activeSession.worktreeBranch && (
          <span className="text-xs text-text-muted bg-surface-2 px-2 py-0.5 rounded">
            {activeSession.worktreeBranch}
          </span>
        )}
        {activeSession.status === 'prompting' && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => useSessionStore.getState().cancelPrompt()}
          >
            Cancel
          </Button>
        )}
      </div>

      {/* Thread view */}
      <div className="flex-1 overflow-y-auto">
        <ThreadView session={activeSession} />
      </div>

      {/* Prompt input */}
      <PromptInput />
    </div>
  )
}
