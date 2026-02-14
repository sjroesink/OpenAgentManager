import React, { useState, useRef, useEffect } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { Badge } from '../common/Badge'
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog'
import type { WorkspaceInfo } from '@shared/types/workspace'
import type { SessionInfo } from '@shared/types/session'

interface WorkspaceSectionProps {
  workspace: WorkspaceInfo
  sessions: SessionInfo[]
}

const statusColors: Record<string, string> = {
  active: 'bg-success',
  prompting: 'bg-accent animate-pulse',
  idle: 'bg-text-muted',
  error: 'bg-error',
  creating: 'bg-warning animate-pulse',
  initializing: 'bg-warning animate-pulse',
  cancelled: 'bg-text-muted'
}

function DeletePopover({
  hasWorktree,
  open,
  onOpen,
  onClose,
  onDelete
}: {
  hasWorktree: boolean
  open: boolean
  onOpen: (e: React.MouseEvent) => void
  onClose: () => void
  onDelete: (cleanupWorktree: boolean) => void
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  return (
    <span className="relative" ref={anchorRef}>
      <span
        role="button"
        onClick={onOpen}
        className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-error"
        title="Delete thread"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </span>
      {open && (
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg bg-surface-2 border border-border shadow-lg shadow-black/40 p-3 space-y-2.5"
        >
          <p className="text-xs font-medium text-text-primary">Are you sure?</p>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            {hasWorktree
              ? 'This will permanently delete the thread history. You can also remove the worktree files.'
              : 'This will permanently delete the thread and its message history.'}
          </p>
          <div className="flex flex-col gap-1">
            {hasWorktree ? (
              <>
                <button
                  onClick={() => onDelete(false)}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-3 text-text-primary transition-colors"
                >
                  Delete thread only
                </button>
                <button
                  onClick={() => onDelete(true)}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-error/20 text-error transition-colors"
                >
                  Delete thread + worktree
                </button>
              </>
            ) : (
              <button
                onClick={() => onDelete(false)}
                className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-error/20 text-error transition-colors"
              >
                Delete
              </button>
            )}
            <button
              onClick={onClose}
              className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-3 text-text-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </span>
  )
}

export function WorkspaceSection({ workspace, sessions }: WorkspaceSectionProps) {
  const { activeSessionId, setActiveSession, deleteSession, draftThread, activeDraftId, startDraftThread, deletingSessionIds } =
    useSessionStore()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const { expandedWorkspaceIds, toggleExpanded, openInVSCode } = useWorkspaceStore()

  const isExpanded = expandedWorkspaceIds.has(workspace.id)
  const hasDraftForThis = draftThread?.workspaceId === workspace.id

  const handleNewThread = (e: React.MouseEvent) => {
    e.stopPropagation()
    startDraftThread(workspace.id, workspace.path)
    // Ensure the workspace section is expanded
    if (!isExpanded) toggleExpanded(workspace.id)
  }

  return (
    <div>
      {/* Workspace header */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 cursor-pointer group"
        onClick={() => toggleExpanded(workspace.id)}
        title={workspace.path}
      >
        {/* Chevron */}
        <svg
          className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        {/* Folder icon */}
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>

        {/* Workspace name */}
        <span className="flex-1 font-medium truncate">{workspace.name}</span>

        {/* New thread button */}
        <button
          onClick={handleNewThread}
          className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
          title="New thread"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {/* Worktree settings button */}
        {workspace.isGitRepo && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowSettings(true)
            }}
            className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
            title="Worktree setup"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}

        {/* VS Code button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            openInVSCode(workspace.path)
          }}
          className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
          title="Open in VS Code"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </button>
      </div>

      {/* Thread list */}
      {isExpanded && (
        <div>
          {/* Draft thread item */}
          {hasDraftForThis && (
            <button
              onClick={() =>
                useSessionStore.setState({ activeDraftId: draftThread!.id, activeSessionId: null })
              }
              className={`
                w-full text-left pl-8 pr-3 py-2 flex items-start gap-2 transition-colors
                ${activeDraftId === draftThread!.id
                  ? 'bg-accent/10 border-r-2 border-accent'
                  : 'hover:bg-surface-2'
                }
              `}
            >
              <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-accent font-medium truncate">New Thread</div>
                <div className="text-[11px] text-text-muted truncate">Configure &amp; send first message</div>
              </div>
            </button>
          )}

          {sessions.length === 0 && !hasDraftForThis ? (
            <div className="px-8 py-1.5 text-[11px] text-text-muted">No threads yet</div>
          ) : (
            sessions.map((session) => {
              const isDeleting = deletingSessionIds.has(session.sessionId)
              return (
                <div key={session.sessionId} className="relative group/thread">
                  <button
                    onClick={() => !isDeleting && setActiveSession(session.sessionId)}
                    disabled={isDeleting}
                    className={`
                      w-full text-left pl-8 pr-3 py-2 flex items-start gap-2 transition-colors
                      ${isDeleting ? 'opacity-50 pointer-events-none' : ''}
                      ${
                        session.sessionId === activeSessionId && !isDeleting
                          ? 'bg-accent/10 border-r-2 border-accent'
                          : 'hover:bg-surface-2'
                      }
                    `}
                  >
                    {isDeleting ? (
                      <svg className="w-3.5 h-3.5 mt-1 shrink-0 text-text-muted animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <span
                        className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${statusColors[session.status] || 'bg-text-muted'}`}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{isDeleting ? 'Deleting...' : session.title}</div>
                      <div className="text-[11px] text-text-muted truncate">{session.agentName}</div>
                      {session.worktreeBranch && !isDeleting && (
                        <Badge variant="default" className="mt-0.5">
                          {session.worktreeBranch}
                        </Badge>
                      )}
                    </div>

                    {/* Thread action buttons */}
                    {!isDeleting && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover/thread:opacity-100 transition-opacity shrink-0 mt-0.5">
                        {/* Open worktree in VS Code */}
                        {session.worktreePath && (
                          <span
                            role="button"
                            onClick={(e) => { e.stopPropagation(); openInVSCode(session.worktreePath!) }}
                            className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary"
                            title="Open worktree in VS Code"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </span>
                        )}
                        {/* Delete thread */}
                        <DeletePopover
                          hasWorktree={!!session.worktreePath}
                          open={confirmDelete === session.sessionId}
                          onOpen={(e) => { e.stopPropagation(); setConfirmDelete(session.sessionId) }}
                          onClose={() => setConfirmDelete(null)}
                          onDelete={(cleanupWorktree) => { deleteSession(session.sessionId, cleanupWorktree); setConfirmDelete(null) }}
                        />
                      </div>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      <WorkspaceSettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        workspacePath={workspace.path}
        workspaceName={workspace.name}
      />
    </div>
  )
}
