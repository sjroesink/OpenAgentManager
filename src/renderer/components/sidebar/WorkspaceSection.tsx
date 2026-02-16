import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useAgentStore } from '../../stores/agent-store'
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog'
import { AgentIcon } from '../common/AgentIcon'
import type { WorkspaceInfo } from '@shared/types/workspace'
import type { SessionInfo, InteractionMode } from '@shared/types/session'

function isInteractionMode(value: string): value is InteractionMode {
  return value === 'ask' || value === 'code' || value === 'plan' || value === 'act'
}

const statusDotColors: Record<string, string> = {
  active: 'bg-success',
  prompting: 'bg-accent animate-pulse',
  idle: 'bg-text-muted/60',
  error: 'bg-error',
  creating: 'bg-warning animate-pulse',
  initializing: 'bg-warning animate-pulse',
  cancelled: 'bg-text-muted/60'
}

function SessionIcon({
  agentId,
  icon,
  name,
  status = 'idle'
}: {
  agentId: string
  icon?: string
  name: string
  status?: string
}) {
  const dotColor = statusDotColors[status] || statusDotColors.idle
  return (
    <div className="relative w-4 h-4 shrink-0">
      <AgentIcon
        agentId={agentId}
        icon={icon}
        name={name}
        size="sm"
      />
      <span className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-surface-0 ${dotColor}`} />
    </div>
  )
}

interface WorkspaceSectionProps {
  workspace: WorkspaceInfo
  sessions: SessionInfo[]
}

// ---- Recursive ThreadItem for tree rendering ----

interface ThreadItemProps {
  session: SessionInfo
  childMap: Map<string, SessionInfo[]>
  pendingPermissionCountBySession: Map<string, number>
  depth: number
  pendingPermissionCount: number
  activeSessionId: string | null
  deletingSessionIds: Set<string>
  editingId: string | null
  editTitle: string
  editInputRef: React.RefObject<HTMLInputElement | null>
  generatingTitle: boolean
  onSelect: (sessionId: string) => void
  onStartRename: (session: SessionInfo) => void
  onCommitRename: () => void
  onSetEditTitle: (title: string) => void
  onCancelEdit: () => void
  onGenerateTitle: (sessionId: string) => void
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void
}

function ThreadItem({
  session,
  childMap,
  pendingPermissionCountBySession,
  depth,
  pendingPermissionCount,
  activeSessionId,
  deletingSessionIds,
  editingId,
  editTitle,
  editInputRef,
  generatingTitle,
  onSelect,
  onStartRename,
  onCommitRename,
  onSetEditTitle,
  onCancelEdit,
  onGenerateTitle,
  onContextMenu
}: ThreadItemProps) {
  const installedAgents = useAgentStore((s) => s.installed)
  const children = childMap.get(session.sessionId) || []
  const hasChildren = children.length > 0
  const [expanded, setExpanded] = useState(true)
  const isDeleting = deletingSessionIds.has(session.sessionId)
  const isActive = session.sessionId === activeSessionId && !isDeleting
  const agentIcon = installedAgents.find((agent) => agent.registryId === session.agentId)?.icon
  const isPrompting = session.status === 'prompting'
  const isStreamingResponse = session.messages.some(
    (message) => message.role === 'agent' && message.isStreaming
  )
  const activityLabel = isStreamingResponse ? 'Responding...' : 'Thinking...'

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
            <SessionIcon
              agentId={session.agentId}
              icon={agentIcon}
              name={session.agentName}
              status={session.status}
            />
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
              <div className="flex items-center gap-2">
                <div
                  className="text-sm truncate flex-1"
                  onDoubleClick={(e) => { e.stopPropagation(); if (!isDeleting) onStartRename(session) }}
                >
                  {isDeleting ? 'Deleting...' : session.title}
                </div>
                {pendingPermissionCount > 0 && !isDeleting && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-error px-1.5 py-0.5 text-[10px] font-semibold text-white shrink-0"
                    title={`${pendingPermissionCount} open permission ${pendingPermissionCount === 1 ? 'question' : 'questions'}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                    {pendingPermissionCount}
                  </span>
                )}
                {isPrompting && !isDeleting && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                    {activityLabel}
                  </span>
                )}
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
              pendingPermissionCountBySession={pendingPermissionCountBySession}
              depth={depth + 1}
              pendingPermissionCount={pendingPermissionCountBySession.get(child.sessionId) || 0}
              activeSessionId={activeSessionId}
              deletingSessionIds={deletingSessionIds}
              editingId={editingId}
              editTitle={editTitle}
              editInputRef={editInputRef}
              generatingTitle={generatingTitle}
              onSelect={onSelect}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onSetEditTitle={onSetEditTitle}
              onCancelEdit={onCancelEdit}
              onGenerateTitle={onGenerateTitle}
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
  const pendingPermissions = useSessionStore((s) => s.pendingPermissions)
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

  const pendingPermissionCountBySession = useMemo(() => {
    const counts = new Map<string, number>()
    for (const permission of pendingPermissions) {
      const current = counts.get(permission.sessionId) || 0
      counts.set(permission.sessionId, current + 1)
    }
    return counts
  }, [pendingPermissions])

  const handleNewThread = async (e: React.MouseEvent) => {
    e.stopPropagation()
    startDraftThread(workspace.id, workspace.path)

    // Apply defaults from workspace metadata or config file
    const { updateDraftThread } = useSessionStore.getState()
    
    // First apply from metadata (fast)
    if (
      workspace.defaultAgentId ||
      workspace.defaultModelId ||
      workspace.defaultInteractionMode ||
      workspace.defaultUseWorktree !== undefined
    ) {
      updateDraftThread({
        agentId: workspace.defaultAgentId || null,
        modelId: workspace.defaultModelId || null,
        interactionMode: workspace.defaultInteractionMode || null,
        useWorktree: !!workspace.defaultUseWorktree
      })
    }

    // Then try to fetch from config file (might have more up-to-date or shared values)
    try {
      const config = await window.api.invoke('workspace:get-config', { workspacePath: workspace.path })
      if (config?.defaults) {
        updateDraftThread({
          agentId: config.defaults.agentId || workspace.defaultAgentId || null,
          modelId: config.defaults.modelId || workspace.defaultModelId || null,
          interactionMode:
            (config.defaults.interactionMode && isInteractionMode(config.defaults.interactionMode)
              ? config.defaults.interactionMode
              : workspace.defaultInteractionMode) || null,
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
        className="group/workspace flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2 cursor-pointer"
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

        <div className="flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto">
          <button
            onClick={handleNewThread}
            className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary"
            title="New Thread"
            aria-label="New Thread"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowSettings(true)
            }}
            className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary"
            title="Workspace Settings"
            aria-label="Workspace Settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11.983 5.5a1.5 1.5 0 012.834 0l.31.93a1.5 1.5 0 001.82.983l.95-.238a1.5 1.5 0 011.417 2.417l-.64.75a1.5 1.5 0 000 1.95l.64.75a1.5 1.5 0 01-1.418 2.417l-.95-.238a1.5 1.5 0 00-1.819.982l-.31.931a1.5 1.5 0 01-2.834 0l-.31-.93a1.5 1.5 0 00-1.82-.983l-.95.238a1.5 1.5 0 01-1.417-2.417l.64-.75a1.5 1.5 0 000-1.95l-.64-.75a1.5 1.5 0 011.418-2.417l.95.238a1.5 1.5 0 001.819-.982l.31-.931z"
              />
              <circle cx="13.4" cy="12" r="2.2" strokeWidth={2} />
            </svg>
          </button>
        </div>
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
                <div className="text-[10px] text-text-muted truncate">Configure &amp; create thread</div>
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
                pendingPermissionCountBySession={pendingPermissionCountBySession}
                depth={0}
                pendingPermissionCount={pendingPermissionCountBySession.get(session.sessionId) || 0}
                activeSessionId={activeSessionId}
                deletingSessionIds={deletingSessionIds}
                editingId={editingId}
                editTitle={editTitle}
                editInputRef={editInputRef}
                generatingTitle={generatingTitle}
                onSelect={setActiveSession}
                onStartRename={startRename}
                onCommitRename={commitRename}
                onSetEditTitle={setEditTitle}
                onCancelEdit={() => setEditingId(null)}
                onGenerateTitle={handleGenerateTitle}
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
        defaultModelId={workspace.defaultModelId}
        defaultInteractionMode={workspace.defaultInteractionMode}
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
                    {confirmDelete === contextMenu.sessionId ? (
                      (() => {
                        const session = sessions.find(s => s.sessionId === contextMenu.sessionId)
                        return (
                          <div className="border-t border-border mt-1 pt-1">
                            {session?.worktreePath ? (
                              <>
                                <button
                                  onClick={() => {
                                    deleteSession(contextMenu.sessionId!, false)
                                    setConfirmDelete(null)
                                    setContextMenu(null)
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
                                >
                                  Delete thread only
                                </button>
                                <button
                                  onClick={() => {
                                    deleteSession(contextMenu.sessionId!, true)
                                    setConfirmDelete(null)
                                    setContextMenu(null)
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/20 text-error"
                                >
                                  Delete thread + worktree
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => {
                                  deleteSession(contextMenu.sessionId!, false)
                                  setConfirmDelete(null)
                                  setContextMenu(null)
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/20 text-error"
                              >
                                Confirm delete
                              </button>
                            )}
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-muted"
                            >
                              Cancel
                            </button>
                          </div>
                        )
                      })()
                    ) : (
                      <button
                        onClick={() => { if (contextMenu.sessionId) { setConfirmDelete(contextMenu.sessionId) } }}
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
