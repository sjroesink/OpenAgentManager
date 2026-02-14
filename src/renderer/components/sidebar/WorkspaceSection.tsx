import React, { useState } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { Badge } from '../common/Badge'
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
  cancelled: 'bg-text-muted'
}

export function WorkspaceSection({ workspace, sessions }: WorkspaceSectionProps) {
  const { activeSessionId, setActiveSession, deleteSession, draftThread, activeDraftId, startDraftThread } =
    useSessionStore()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
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
            sessions.map((session) => (
              <div key={session.sessionId} className="relative group/thread">
                {/* Delete confirmation overlay */}
                {confirmDelete === session.sessionId && (
                  <div className="absolute inset-0 z-10 bg-surface-1/95 flex flex-col items-center justify-center gap-1.5 px-2">
                    <span className="text-[11px] text-text-secondary text-center">
                      {session.worktreePath ? 'Also remove worktree from disk?' : 'Delete this thread?'}
                    </span>
                    <div className="flex gap-1.5">
                      {session.worktreePath ? (
                        <>
                          <button
                            onClick={() => { deleteSession(session.sessionId, false); setConfirmDelete(null) }}
                            className="px-2 py-0.5 text-[11px] rounded bg-surface-3 hover:bg-surface-2 text-text-secondary"
                          >
                            Keep worktree
                          </button>
                          <button
                            onClick={() => { deleteSession(session.sessionId, true); setConfirmDelete(null) }}
                            className="px-2 py-0.5 text-[11px] rounded bg-error/20 hover:bg-error/30 text-error"
                          >
                            Remove all
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { deleteSession(session.sessionId, false); setConfirmDelete(null) }}
                          className="px-2 py-0.5 text-[11px] rounded bg-error/20 hover:bg-error/30 text-error"
                        >
                          Delete
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-0.5 text-[11px] rounded bg-surface-3 hover:bg-surface-2 text-text-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setActiveSession(session.sessionId)}
                  className={`
                    w-full text-left pl-8 pr-3 py-2 flex items-start gap-2 transition-colors
                    ${
                      session.sessionId === activeSessionId
                        ? 'bg-accent/10 border-r-2 border-accent'
                        : 'hover:bg-surface-2'
                    }
                  `}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${statusColors[session.status] || 'bg-text-muted'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{session.title}</div>
                    <div className="text-[11px] text-text-muted truncate">{session.agentName}</div>
                    {session.worktreeBranch && (
                      <Badge variant="default" className="mt-0.5">
                        {session.worktreeBranch}
                      </Badge>
                    )}
                  </div>

                  {/* Thread action buttons */}
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
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(session.sessionId) }}
                      className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-error"
                      title="Delete thread"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </span>
                  </div>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
