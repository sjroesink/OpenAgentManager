import React, { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useAgentStore } from '../../stores/agent-store'
import { ThreadView } from '../thread/ThreadView'
import { PromptInput } from '../thread/PromptInput'
import { DraftThreadView } from '../thread/DraftThreadView'
import { Button } from '../common/Button'
import { AgentIcon } from '../common/AgentIcon'
import { useRouteStore } from '../../stores/route-store'
import { useUiStore } from '../../stores/ui-store'
import vscodeIcon from '../../assets/icons/vscode.svg'

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
  const {
    getActiveSession,
    activeDraftId,
    draftThread,
    startDraftThread,
    renameSession,
    forkSession,
    deleteSession
  } = useSessionStore()
  const { workspaces, createWorkspace, openInVSCode } = useWorkspaceStore()
  const toggleTerminal = useUiStore((s) => s.toggleTerminal)
  const navigate = useRouteStore((s) => s.navigate)
  const installedAgents = useAgentStore((s) => s.installed)
  const activeSession = getActiveSession()
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [openInMenuOpen, setOpenInMenuOpen] = useState(false)
  const threadMenuRef = useRef<HTMLDivElement>(null)
  const openInMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!threadMenuOpen && !openInMenuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (threadMenuRef.current && !threadMenuRef.current.contains(event.target as Node)) {
        setThreadMenuOpen(false)
      }
      if (openInMenuRef.current && !openInMenuRef.current.contains(event.target as Node)) {
        setOpenInMenuOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setThreadMenuOpen(false)
        setOpenInMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [threadMenuOpen, openInMenuOpen])

  // Draft thread view — workspace + agent configuration before creating a thread
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
          const existingDraft = useSessionStore.getState().draftThread
          if (existingDraft) {
            useSessionStore.getState().setActiveDraft(existingDraft.id)
            navigate('new-thread', { draftId: existingDraft.id })
            return
          }

          const sorted = [...workspaces].sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
          if (sorted.length > 0) {
            startDraftThread(sorted[0].id, sorted[0].path)
            const draftId = useSessionStore.getState().draftThread?.id
            if (draftId) {
              navigate('new-thread', { draftId })
            }
          } else {
            const path = await window.api.invoke('workspace:select-directory', undefined)
            if (!path) return
            try {
              const ws = await createWorkspace(path)
              startDraftThread(ws.id, ws.path)
              const draftId = useSessionStore.getState().draftThread?.id
              if (draftId) {
                navigate('new-thread', { draftId })
              }
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

  const activeSessionAgentIcon = installedAgents.find(
    (agent) => agent.registryId === activeSession.agentId
  )?.icon
  const canFork =
    activeSession.status !== 'prompting' &&
    activeSession.status !== 'creating' &&
    activeSession.status !== 'initializing'

  const handleRename = () => {
    const nextTitle = window.prompt('Rename thread', activeSession.title)
    if (!nextTitle || !nextTitle.trim()) return
    renameSession(activeSession.sessionId, nextTitle.trim())
    setThreadMenuOpen(false)
  }

  const handleFork = async () => {
    try {
      await forkSession(activeSession.sessionId)
      setThreadMenuOpen(false)
    } catch (error) {
      console.error('Fork failed:', error)
    }
  }

  const handleDeleteThread = (cleanupWorktree: boolean) => {
    const prompt = cleanupWorktree
      ? 'Delete this thread and its worktree files?'
      : 'Delete this thread?'
    if (!window.confirm(prompt)) return
    deleteSession(activeSession.sessionId, cleanupWorktree)
    setThreadMenuOpen(false)
  }
  const currentDirectory = activeSession.worktreePath || activeSession.workingDir

  const handleOpenFolder = async () => {
    try {
      await window.api.invoke('workspace:open-directory', { path: currentDirectory })
      setOpenInMenuOpen(false)
    } catch (error) {
      console.error('Failed to open directory:', error)
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Session header */}
      <div className="flex items-center px-4 py-2 border-b border-border gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <AgentIcon
            agentId={activeSession.agentId}
            icon={activeSessionAgentIcon}
            name={activeSession.agentName}
            size="sm"
            className="w-5 h-5"
          />
          <span className="text-sm font-medium truncate">{activeSession.agentName}</span>
          <span className="text-xs text-text-muted truncate">{activeSession.title}</span>
        </div>
        <div className="flex-1" />
        {activeSession.worktreeBranch && (
          <span className="text-xs text-text-muted bg-surface-2 px-2 py-0.5 rounded">
            {activeSession.worktreeBranch}
          </span>
        )}
        <span
          className="text-xs text-text-muted truncate max-w-[34vw]"
          title={currentDirectory}
        >
          {currentDirectory}
        </span>
        <div className="relative" ref={openInMenuRef}>
          <button
            onClick={() => setOpenInMenuOpen((v) => !v)}
            className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
            title="Open in"
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
          {openInMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-40 rounded-lg bg-surface-2 border border-border shadow-lg shadow-black/40 py-1.5">
              <button
                onClick={() => {
                  openInVSCode(currentDirectory)
                  setOpenInMenuOpen(false)
                }}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
              >
                <img src={vscodeIcon} alt="" className="w-3.5 h-3.5 shrink-0" />
                VS Code
              </button>
              <button
                onClick={() => {
                  toggleTerminal()
                  setOpenInMenuOpen(false)
                }}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Terminal
              </button>
              <button
                onClick={() => { void handleOpenFolder() }}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                Folder
              </button>
            </div>
          )}
        </div>
        <div className="relative" ref={threadMenuRef}>
          <button
            onClick={() => setThreadMenuOpen((v) => !v)}
            className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
            title="Thread menu"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5h.01M12 12h.01M12 19h.01" />
            </svg>
          </button>

          {threadMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-48 rounded-lg bg-surface-2 border border-border shadow-lg shadow-black/40 py-1.5">
              {canFork && (
                <button
                  onClick={handleFork}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
                >
                  Fork Thread
                </button>
              )}
              <button
                onClick={handleRename}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
              >
                Rename
              </button>
              <div className="border-t border-border my-1" />
              {activeSession.worktreePath ? (
                <>
                  <button
                    onClick={() => handleDeleteThread(false)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
                  >
                    Delete thread only
                  </button>
                  <button
                    onClick={() => handleDeleteThread(true)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/20 text-error"
                  >
                    Delete thread + worktree
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleDeleteThread(false)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/20 text-error"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
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
      <ThreadView session={activeSession} />

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
