import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useAgentStore } from '../../stores/agent-store'
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog'
import type { WorkspaceInfo } from '@shared/types/workspace'
import type { SessionInfo } from '@shared/types/session'

const AGENT_ICON_BASE = 'https://cdn.agentclientprotocol.com/registry/v1/latest'

const statusColors: Record<string, string> = {
  active: 'text-success',
  prompting: 'text-accent animate-pulse',
  idle: 'text-text-muted',
  error: 'text-error',
  creating: 'text-warning animate-pulse',
  initializing: 'text-warning animate-pulse',
  cancelled: 'text-text-muted'
}

function SessionIcon({ agentId, name, status = 'idle' }: { agentId: string; name: string; status?: string }) {
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const iconUrl = `${AGENT_ICON_BASE}/${agentId}.svg`
  const colorClass = statusColors[status] || statusColors.idle

  useEffect(() => {
    fetch(iconUrl)
      .then((res) => res.text())
      .then((svg) => setSvgContent(svg))
      .catch(() => setSvgContent(null))
  }, [iconUrl])

  if (svgContent) {
    return (
      <span
        className={`w-4 h-4 shrink-0 ${colorClass}`}
        dangerouslySetInnerHTML={{ __html: svgContent.replace(/<svg/, '<svg class="w-4 h-4"') }}
      />
    )
  }

  return (
    <span className={`w-4 h-4 rounded bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 ${colorClass}`}>
      {name[0]}
    </span>
  )
}

interface WorkspaceSectionProps {
  workspace: WorkspaceInfo
  sessions: SessionInfo[]
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
  generatingTitle: boolean
  onSelect: (sessionId: string) => void
  onStartRename: (session: SessionInfo) => void
  onCommitRename: () => void
  onSetEditTitle: (title: string) => void
  onCancelEdit: () => void
  onGenerateTitle: (sessionId: string) => void
  onFork: (sessionId: string) => void
  onOpenInVSCode: (path: string) => void
  onSetConfirmDelete: (sessionId: string | null) => void
  onDelete: (sessionId: string, cleanupWorktree: boolean) => void
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void
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
  generatingTitle,
  onSelect,
  onStartRename,
  onCommitRename,
  onSetEditTitle,
  onCancelEdit,
  onGenerateTitle,
  onFork,
  onOpenInVSCode,
  onSetConfirmDelete,
  onDelete,
  onContextMenu
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
          onContextMenu={(e) => !isDeleting && onContextMenu(e, session.sessionId)}
          disabled={isDeleting}
          style={{ paddingLeft }}
          className={`
            w-full text-left pr-3 py-0.5 flex items-start gap-2 transition-colors
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
            <SessionIcon agentId={session.agentId} name={session.agentName} status={session.status} />
          )}

          <div className="flex-1 min-w-0">
            {editingId === session.sessionId ? (
              <div className="flex items-center gap-1">
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
                  className="text-sm flex-1 bg-surface-2 border border-accent rounded px-1 py-0 outline-none text-text-primary"
                  autoFocus
                />
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onGenerateTitle(session.sessionId) }}
                  disabled={generatingTitle}
                  className="p-0.5 rounded hover:bg-surface-3 text-accent disabled:opacity-50 shrink-0"
                  title="Generate title with AI"
                >
                  {generatingTitle ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  )}
                </button>
              </div>
            ) : (
              <div
                className="text-sm truncate"
                onDoubleClick={(e) => { e.stopPropagation(); if (!isDeleting) onStartRename(session) }}
              >
                {isDeleting ? 'Deleting...' : session.title}
              </div>
            )}
          </div>
        </button>
      </div>

      {/* Children (recursive) */}
      {expanded && hasChildren && (
        <div>
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
              generatingTitle={generatingTitle}
              onSelect={onSelect}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onSetEditTitle={onSetEditTitle}
              onCancelEdit={onCancelEdit}
              onGenerateTitle={onGenerateTitle}
              onFork={onFork}
              onOpenInVSCode={onOpenInVSCode}
              onSetConfirmDelete={onSetConfirmDelete}
              onDelete={onDelete}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ---- Main WorkspaceSection ----

export function WorkspaceSection({ workspace, sessions }: WorkspaceSectionProps) {
  const { activeSessionId, setActiveSession, deleteSession, renameSession, generateTitle, forkSession, draftThread, activeDraftId, startDraftThread, deletingSessionIds } =
    useSessionStore()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [generatingTitle, setGeneratingTitle] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'workspace' | 'thread'; sessionId?: string } | null>(null)
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

  const handleNewThread = async (e: React.MouseEvent) => {
    e.stopPropagation()
    startDraftThread(workspace.id, workspace.path)

    // Apply defaults from workspace metadata or config file
    const { updateDraftThread } = useSessionStore.getState()
    
    // First apply from metadata (fast)
    if (workspace.defaultAgentId || workspace.defaultUseWorktree !== undefined) {
      updateDraftThread({
        agentId: workspace.defaultAgentId || null,
        useWorktree: !!workspace.defaultUseWorktree
      })
    }

    // Then try to fetch from config file (might have more up-to-date or shared values)
    try {
      const config = await window.api.invoke('workspace:get-config', { workspacePath: workspace.path })
      if (config?.defaults) {
        updateDraftThread({
          agentId: config.defaults.agentId || workspace.defaultAgentId || null,
          useWorktree: config.defaults.useWorktree ?? workspace.defaultUseWorktree ?? false
        })
      }
    } catch (err) {
      console.error('Failed to load workspace defaults from config:', err)
    }

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

  const handleGenerateTitle = async (sessionId: string) => {
    console.log('[handleGenerateTitle] Starting for sessionId:', sessionId)
    setGeneratingTitle(true)
    try {
      const title = await generateTitle(sessionId)
      console.log('[handleGenerateTitle] Result:', title)
      if (title) {
        setEditingId(null)
      } else {
        console.warn('Title generation returned null - check if summarization agent is configured and session has messages')
      }
    } catch (error) {
      console.error('Failed to generate title:', error)
    } finally {
      setGeneratingTitle(false)
    }
  }

  const handleFork = async (sessionId: string) => {
    try {
      await forkSession(sessionId)
    } catch (error) {
      console.error('Fork failed:', error)
    }
  }

  const handleThreadContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'thread', sessionId })
  }

  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [contextMenu])

  return (
    <div>
      {/* Workspace header */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2 cursor-pointer group"
        onClick={() => toggleExpanded(workspace.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY, type: 'workspace' })
        }}
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
          className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-accent opacity-0 group-hover:opacity-100"
          title="New thread"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {/* Worktree settings button */}
        {/* Workspace settings button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowSettings(true)
          }}
          className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100"
          title="Workspace settings"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* VS Code button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            openInVSCode(workspace.path)
          }}
          className="p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100"
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
                w-full text-left pl-8 pr-3 py-1 flex items-start gap-2 transition-colors
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
            <div className="px-8 py-1 text-[11px] text-text-muted">No threads yet</div>
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
                generatingTitle={generatingTitle}
                onSelect={setActiveSession}
                onStartRename={startRename}
                onCommitRename={commitRename}
                onSetEditTitle={setEditTitle}
                onCancelEdit={() => setEditingId(null)}
                onGenerateTitle={handleGenerateTitle}
                onFork={handleFork}
                onOpenInVSCode={openInVSCode}
                onSetConfirmDelete={setConfirmDelete}
                onDelete={deleteSession}
                onContextMenu={handleThreadContextMenu}
              />
            ))
          )}
        </div>
      )}

      <WorkspaceSettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        workspaceId={workspace.id}
        workspacePath={workspace.path}
        workspaceName={workspace.name}
        defaultAgentId={workspace.defaultAgentId}
        defaultUseWorktree={workspace.defaultUseWorktree}
      />

      {contextMenu && (
        <div
          className="fixed z-50 w-48 rounded-lg bg-surface-2 border border-border shadow-lg shadow-black/40 py-1.5"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'workspace' && (
            <>
              <button
                onClick={() => { handleNewThread({ stopPropagation: () => {} } as React.MouseEvent); setContextMenu(null) }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
              >
                New Thread
              </button>
              {workspace.isGitRepo && (
                <button
                  onClick={() => { setShowSettings(true); setContextMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
                >
                  Worktree Settings
                </button>
              )}
              <button
                onClick={() => { openInVSCode(workspace.path); setContextMenu(null) }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
              >
                Open in VS Code
              </button>
            </>
          )}
          {contextMenu.type === 'thread' && contextMenu.sessionId && (
            <>
              {(() => {
                const session = sessions.find(s => s.sessionId === contextMenu.sessionId)
                const canFork = session && session.status !== 'prompting' && session.status !== 'creating' && session.status !== 'initializing'
                return (
                  <>
                    {canFork && (
                    <button
                      onClick={() => { if (contextMenu.sessionId) { handleFork(contextMenu.sessionId); setContextMenu(null) } }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
                    >
                      Fork Thread
                    </button>
                    )}
                    <button
                      onClick={() => { startRename(session!); setContextMenu(null) }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
                    >
                      Rename
                    </button>
                    {session?.worktreePath && (
                      <button
                        onClick={() => { openInVSCode(session.worktreePath!); setContextMenu(null) }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
                      >
                        Open in VS Code
                      </button>
                    )}
                    {confirmDelete && contextMenu.sessionId ? (
                      (() => {
                        const session = sessions.find(s => s.sessionId === contextMenu.sessionId)
                        return (
                          <DeletePopover
                            hasWorktree={!!session?.worktreePath}
                            open={true}
                            onOpen={() => {}}
                            onClose={() => setConfirmDelete(null)}
                            onDelete={(cleanupWorktree) => { deleteSession(contextMenu.sessionId!, cleanupWorktree); setConfirmDelete(null) }}
                          />
                        )
                      })()
                    ) : (
                      <button
                        onClick={() => { if (contextMenu.sessionId) { setConfirmDelete(contextMenu.sessionId); setContextMenu(null) } }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/20 text-error"
                      >
                        Delete
                      </button>
                    )}
                  </>
                )
              })()}
            </>
          )}
        </div>
      )}
    </div>
  )
}
