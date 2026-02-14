import React from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useUiStore } from '../../stores/ui-store'
import { ThreadView } from '../thread/ThreadView'
import { PromptInput } from '../thread/PromptInput'
import { DraftThreadView } from '../thread/DraftThreadView'
import { Spinner } from '../common/Spinner'
import { Button } from '../common/Button'

export function MainPanel() {
  const { getActiveSession, activeDraftId, draftThread } = useSessionStore()
  const setNewThreadDialogOpen = useUiStore((s) => s.setNewThreadDialogOpen)
  const activeSession = getActiveSession()

  // Draft thread view — agent selector + worktree toggle + message input
  if (activeDraftId && draftThread) {
    return <DraftThreadView draft={draftThread} />
  }

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
          <p className="text-lg font-medium text-text-secondary mb-1">Let's build</p>
          <p className="text-sm">Create a new thread to start working with an agent</p>
        </div>
        <Button variant="primary" onClick={() => setNewThreadDialogOpen(true)}>
          New Thread
        </Button>
      </div>
    )
  }

  // Show a loading state while the session is being created
  if (activeSession.status === 'creating') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3">
        <Spinner size="lg" />
        <p className="text-sm">Starting agent session...</p>
      </div>
    )
  }

  const statusColor = activeSession.status === 'error' ? 'bg-error' : 'bg-success'

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Session header */}
      <div className="flex items-center px-4 py-2 border-b border-border gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
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
