import React, { useState, useRef, useEffect, useMemo } from 'react'
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

// ---- Recursive ThreadItem for tree rendering ----

interface ThreadItemProps {
  session: SessionInfo
  childMap: Map<string, SessionInfo[]>
  depth: number
  activeSessionId: string | null
  deletingSessionIds: Set<string>
  editingId: string | null
  editTitle: string
  editInputRef: React.RefObject<HTMLInputElement | null>
  confirmDelete: string | null
  onSelect: (sessionId: string) => void
  onStartRename: (session: SessionInfo) => void
  onCommitRename: () => void
  onSetEditTitle: (title: string) => void
  onCancelEdit: () => void
  onFork: (sessionId: string) => void
  onOpenInVSCode: (path: string) => void
  onSetConfirmDelete: (sessionId: string | null) => void
  onDelete: (sessionId: string, cleanupWorktree: boolean) => void
}

function ThreadItem({
  session,
  childMap,
  depth,
  activeSessionId,
  deletingSessionIds,
  editingId,
  editTitle,
  editInputRef,
  confirmDelete,
  onSelect,
  onStartRename,
  onCommitRename,
  onSetEditTitle,
  onCancelEdit,
  onFork,
  onOpenInVSCode,
  onSetConfirmDelete,
  onDelete
}: ThreadItemProps) {
  const children = childMap.get(session.sessionId) || []
  const hasChildren = children.length > 0
  const [expanded, setExpanded] = useState(true)
  const isDeleting = deletingSessionIds.has(session.sessionId)
  const isActive = session.sessionId === activeSessionId && !isDeleting
  const canFork = session.status !== 'prompting' && session.status !== 'creating' && session.status !== 'initializing'

  // Dynamic indent: base 32px + 16px per depth level, capped at 4 levels
  const paddingLeft = 32 + Math.min(depth, 4) * 16

  return (
    <>
      <div className="relative group/thread">
        <button
          onClick={() => !isDeleting && onSelect(session.sessionId)}
          disabled={isDeleting}
          style={{ paddingLeft }}
          className={`
            w-full text-left pr-3 py-1.5 flex items-start gap-2 transition-colors
            ${isDeleting ? 'opacity-50 pointer-events-none' : ''}
            ${isActive ? 'bg-accent/10 border-r-2 border-accent' : 'hover:bg-surface-2'}
          `}
        >
          {/* Expand chevron for threads with children */}
          {hasChildren ? (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
              className="p-0 mt-1 shrink-0 text-text-muted hover:text-text-primary"
            >
              <svg
                className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </span>
          ) : isDeleting ? (
            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-text-muted animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <span
              className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${statusColors[session.status] || 'bg-text-muted'}`}
            />
          )}

          <div className="flex-1 min-w-0">
            {editingId === session.sessionId ? (
              <input
                ref={editInputRef}
                value={editTitle}
                onChange={(e) => onSetEditTitle(e.target.value)}
                onBlur={onCommitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCommitRename()
                  if (e.key === 'Escape') onCancelEdit()
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-sm w-full bg-surface-2 border border-accent rounded px-1 py-0 outline-none text-text-primary"
                autoFocus
              />
            ) : (
              <div
                className="text-sm truncate"
                onDoubleClick={(e) => { e.stopPropagation(); if (!isDeleting) onStartRename(session) }}
              >
                {isDeleting ? 'Deleting...' : session.title}
              </div>
            )}
            <div className="text-[10px] text-text-muted truncate opacity-0 group-hover/thread:opacity-100 transition-opacity">{session.agentName}</div>
            {session.worktreeBranch && !isDeleting && (
              <Badge variant="default" className="mt-0.5">
                {session.worktreeBranch}
              </Badge>
            )}
          </div>

          {/* Thread action buttons */}
          {!isDeleting && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover/thread:opacity-100 transition-opacity shrink-0 mt-0.5">
              {/* Fork thread */}
              {canFork && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); onFork(session.sessionId) }}
                  className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-accent"
                  title="Fork thread"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 3v6m0 0a3 3 0 103 3V9m-3 3a3 3 0 10-3 3m12-9v6m0 0a3 3 0 103 3V9m-3 3a3 3 0 10-3 3" />
                  </svg>
                </span>
              )}
              {/* Rename thread */}
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); onStartRename(session) }}
                className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary"
                title="Rename thread"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </span>
              {/* Open worktree in VS Code */}
              {session.worktreePath && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); onOpenInVSCode(session.worktreePath!) }}
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
                onOpen={(e) => { e.stopPropagation(); onSetConfirmDelete(session.sessionId) }}
                onClose={() => onSetConfirmDelete(null)}
                onDelete={(cleanupWorktree) => { onDelete(session.sessionId, cleanupWorktree); onSetConfirmDelete(null) }}
              />
            </div>
          )}
        </button>
      </div>

      {/* Children (recursive) */}
      {expanded && hasChildren && (
        <div className="relative">
          {/* Tree line connector */}
          <div
            className="absolute top-0 bottom-0 border-l border-border/30"
            style={{ left: paddingLeft + 5 }}
          />
          {children.map((child) => (
            <ThreadItem
              key={child.sessionId}
              session={child}
              childMap={childMap}
              depth={depth + 1}
              activeSessionId={activeSessionId}
              deletingSessionIds={deletingSessionIds}
              editingId={editingId}
              editTitle={editTitle}
              editInputRef={editInputRef}
              confirmDelete={confirmDelete}
              onSelect={onSelect}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onSetEditTitle={onSetEditTitle}
              onCancelEdit={onCancelEdit}
              onFork={onFork}
              onOpenInVSCode={onOpenInVSCode}
              onSetConfirmDelete={onSetConfirmDelete}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ---- Main WorkspaceSection ----

export function WorkspaceSection({ workspace, sessions }: WorkspaceSectionProps) {
  const { activeSessionId, setActiveSession, deleteSession, renameSession, forkSession, draftThread, activeDraftId, startDraftThread, deletingSessionIds } =
    useSessionStore()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const { expandedWorkspaceIds, toggleExpanded, openInVSCode } = useWorkspaceStore()

  const isExpanded = expandedWorkspaceIds.has(workspace.id)
  const hasDraftForThis = draftThread?.workspaceId === workspace.id

  // Build tree structure from flat sessions list
  const childMap = useMemo(() => {
    const map = new Map<string, SessionInfo[]>()
    const sessionIds = new Set(sessions.map((s) => s.sessionId))
    for (const s of sessions) {
      // Only group under parent if parent is in this workspace's sessions
      if (s.parentSessionId && sessionIds.has(s.parentSessionId)) {
        const children = map.get(s.parentSessionId) || []
        children.push(s)
        map.set(s.parentSessionId, children)
      }
    }
    return map
  }, [sessions])

  const rootSessions = useMemo(() => {
    const sessionIds = new Set(sessions.map((s) => s.sessionId))
    return sessions.filter(
      (s) => !s.parentSessionId || !sessionIds.has(s.parentSessionId)
    )
  }, [sessions])

  const handleNewThread = (e: React.MouseEvent) => {
    e.stopPropagation()
    startDraftThread(workspace.id, workspace.path)
    if (!isExpanded) toggleExpanded(workspace.id)
  }

  const startRename = (session: SessionInfo) => {
    setEditingId(session.sessionId)
    setEditTitle(session.title)
    setTimeout(() => editInputRef.current?.select(), 0)
  }

  const commitRename = () => {
    if (editingId && editTitle.trim()) {
      renameSession(editingId, editTitle.trim())
    }
    setEditingId(null)
  }

  const handleFork = async (sessionId: string) => {
    try {
      await forkSession(sessionId)
    } catch (error) {
      console.error('Fork failed:', error)
    }
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

      {/* Thread tree */}
      {isExpanded && (
        <div>
          {/* Draft thread item */}
          {hasDraftForThis && (
            <button
              onClick={() =>
                useSessionStore.setState({ activeDraftId: draftThread!.id, activeSessionId: null })
              }
              className={`
                w-full text-left pl-8 pr-3 py-1.5 flex items-start gap-2 transition-colors
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
                <div className="text-[10px] text-text-muted truncate">Configure &amp; send first message</div>
              </div>
            </button>
          )}

          {rootSessions.length === 0 && !hasDraftForThis ? (
            <div className="px-8 py-1.5 text-[11px] text-text-muted">No threads yet</div>
          ) : (
            rootSessions.map((session) => (
              <ThreadItem
                key={session.sessionId}
                session={session}
                childMap={childMap}
                depth={0}
                activeSessionId={activeSessionId}
                deletingSessionIds={deletingSessionIds}
                editingId={editingId}
                editTitle={editTitle}
                editInputRef={editInputRef}
                confirmDelete={confirmDelete}
                onSelect={setActiveSession}
                onStartRename={startRename}
                onCommitRename={commitRename}
                onSetEditTitle={setEditTitle}
                onCancelEdit={() => setEditingId(null)}
                onFork={handleFork}
                onOpenInVSCode={openInVSCode}
                onSetConfirmDelete={setConfirmDelete}
                onDelete={deleteSession}
              />
            ))
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
