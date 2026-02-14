import React from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { ThreadView } from '../thread/ThreadView'
import { PromptInput } from '../thread/PromptInput'
import { DraftThreadView } from '../thread/DraftThreadView'
import { Button } from '../common/Button'

/**
 * Shows worktree hook progress during session creation as a checklist.
 *
 * The placeholder session in the renderer has a temporary ID (e.g. "creating-xyz")
 * while the main process generates the real UUID and sends hook events with that UUID.
 * Since only one session can be creating at a time, we pick the latest event with steps.
 */
function HookProgressLabel({ fallback }: { fallback: string }) {
  const steps = useSessionStore((s) => {
    const entries = Object.values(s.hookProgress)
    // Find the latest event that has steps
    const latest = entries.find((e) => e.steps && e.steps.length > 0)
    return latest?.steps ?? null
  })

  if (!steps || steps.length === 0) {
    return <p className="text-sm">{fallback}</p>
  }

  return (
    <div className="text-left w-72">
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-2 py-0.5">
          {/* Status icon */}
          <span className="mt-0.5 shrink-0 w-4 h-4 flex items-center justify-center">
            {step.status === 'completed' && (
              <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {step.status === 'running' && (
              <svg className="w-3.5 h-3.5 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {step.status === 'failed' && (
              <svg className="w-3.5 h-3.5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {step.status === 'pending' && (
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
            )}
          </span>
          {/* Label + detail */}
          <div className="flex-1 min-w-0">
            <span className={`text-xs ${step.status === 'running' ? 'text-text-primary' : step.status === 'failed' ? 'text-error' : 'text-text-secondary'}`}>
              {step.label}
            </span>
            {step.status === 'failed' && step.detail && (
              <p className="text-[10px] text-error/70 truncate">{step.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function MainPanel() {
  const { getActiveSession, activeDraftId, draftThread, startDraftThread } = useSessionStore()
  const { workspaces, createWorkspace, openInVSCode } = useWorkspaceStore()
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
        <Button variant="primary" onClick={async () => {
          const sorted = [...workspaces].sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
          if (sorted.length > 0) {
            startDraftThread(sorted[0].id, sorted[0].path)
          } else {
            const path = await window.api.invoke('workspace:select-directory', undefined)
            if (!path) return
            try {
              const ws = await createWorkspace(path)
              startDraftThread(ws.id, ws.path)
            } catch (err) {
              console.error('Failed to create workspace:', err)
            }
          }
        }}>
          New Thread
        </Button>
      </div>
    )
  }

  const statusColor = activeSession.status === 'initializing' || activeSession.status === 'creating'
    ? 'bg-warning animate-pulse'
    : activeSession.status === 'error'
      ? 'bg-error'
      : 'bg-success'

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
        <button
          onClick={() => openInVSCode(activeSession.worktreePath || activeSession.workingDir)}
          className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
          title="Open in VS Code"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </button>
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

      {/* Hook progress banner (during session creation) */}
      {activeSession.status === 'creating' && (
        <div className="border-t border-border bg-surface-1 px-4 py-2.5 shrink-0">
          <div className="max-w-3xl mx-auto">
            <HookProgressLabel fallback="Starting agent session..." />
          </div>
        </div>
      )}

      {/* Prompt input */}
      <PromptInput />
    </div>
  )
}
