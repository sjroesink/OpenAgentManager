import type { SessionInfo } from '@shared/types/session'
import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react'

import { AgentIcon } from '../common/AgentIcon'
import { useAgentStore } from '../../stores/agent-store'
import { useRouteStore } from '../../stores/route-store'
import { useSessionStore } from '../../stores/session-store'
import { useUiStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

const statusLabels: Record<string, string> = {
  active: 'Active',
  prompting: 'Responding',
  idle: 'Idle',
  error: 'Error',
  creating: 'Creating',
  initializing: 'Initializing',
  cancelled: 'Cancelled'
}

const statusColors: Record<string, string> = {
  active: 'bg-success/15 text-success',
  prompting: 'bg-accent/15 text-accent',
  idle: 'bg-surface-3 text-text-muted',
  error: 'bg-error/15 text-error',
  creating: 'bg-warning/15 text-warning',
  initializing: 'bg-warning/15 text-warning',
  cancelled: 'bg-surface-3 text-text-muted'
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function getLastActivity(session: SessionInfo): string {
  if (session.messages.length === 0) return session.createdAt
  return session.messages[session.messages.length - 1].timestamp
}

function getMessagePreview(session: SessionInfo): string {
  if (session.messages.length === 0) return 'No messages yet'
  // Find the last message with text content
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i]
    for (const block of msg.content) {
      if (block.type === 'text' && block.text.trim()) {
        const prefix = msg.role === 'user' ? 'You: ' : ''
        const text = block.text.trim().replace(/\n/g, ' ')
        return prefix + (text.length > 120 ? text.slice(0, 120) + '...' : text)
      }
    }
  }
  return 'No messages yet'
}

export function ThreadsOverview() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const forkSession = useSessionStore((s) => s.forkSession)
  const deletingSessionIds = useSessionStore((s) => s.deletingSessionIds)
  const pendingPermissions = useSessionStore((s) => s.pendingPermissions)
  const openInVSCode = useWorkspaceStore((s) => s.openInVSCode)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const installedAgents = useAgentStore((s) => s.installed)
  const searchQuery = useUiStore((s) => s.threadsOverviewSearchQuery)
  const shouldFocusSearch = useUiStore((s) => s.threadsOverviewFocusSearch)
  const setSearchQuery = useUiStore((s) => s.setThreadsOverviewSearchQuery)
  const closeThreadsOverview = useUiStore((s) => s.closeThreadsOverview)
  const navigate = useRouteStore((s) => s.navigate)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({})
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [threadContextMenu, setThreadContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null)

  useEffect(() => {
    if (shouldFocusSearch) {
      searchInputRef.current?.focus()
    }
  }, [shouldFocusSearch])

  const workspaceMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const ws of workspaces) {
      map.set(ws.id, ws.name)
    }
    return map
  }, [workspaces])

  const pendingCountBySession = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of pendingPermissions) {
      counts.set(p.sessionId, (counts.get(p.sessionId) || 0) + 1)
    }
    return counts
  }, [pendingPermissions])

  const filteredAndSorted = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    let filtered = sessions
    if (query) {
      filtered = sessions.filter((s) => {
        const workspaceName = workspaceMap.get(s.workspaceId) || ''
        return (
          s.title.toLowerCase().includes(query) ||
          s.agentName.toLowerCase().includes(query) ||
          workspaceName.toLowerCase().includes(query) ||
          s.status.toLowerCase().includes(query) ||
          (s.worktreeBranch && s.worktreeBranch.toLowerCase().includes(query))
        )
      })
    }
    // Sort by last activity (most recent first)
    return [...filtered].sort((a, b) => {
      const aTime = getLastActivity(a)
      const bTime = getLastActivity(b)
      return bTime.localeCompare(aTime)
    })
  }, [sessions, searchQuery, workspaceMap])

  const groupedByWorkspace = useMemo(() => {
    const groups = new Map<string, SessionInfo[]>()
    for (const session of filteredAndSorted) {
      const key = session.workspaceId || '__unknown_workspace__'
      const existing = groups.get(key)
      if (existing) {
        existing.push(session)
      } else {
        groups.set(key, [session])
      }
    }
    return [...groups.entries()]
  }, [filteredAndSorted])

  const visibleSessionIds = useMemo(() => filteredAndSorted.map((s) => s.sessionId), [filteredAndSorted])

  const selectedSessions = useMemo(
    () => sessions.filter((s) => selectedSessionIds.has(s.sessionId)),
    [sessions, selectedSessionIds]
  )

  const selectedCount = selectedSessions.length
  const selectedWithWorktreeCount = selectedSessions.filter((s) => !!s.worktreePath).length
  const allVisibleSelected =
    visibleSessionIds.length > 0 && visibleSessionIds.every((id) => selectedSessionIds.has(id))

  const contextSession = useMemo(() => {
    if (!threadContextMenu) return null
    return sessions.find((s) => s.sessionId === threadContextMenu.sessionId) || null
  }, [sessions, threadContextMenu])

  const handleSelect = (sessionId: string) => {
    setActiveSession(sessionId)
    closeThreadsOverview()
    navigate('home', { sessionId })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (searchQuery) {
        setSearchQuery('')
      } else {
        closeThreadsOverview()
        navigate('home')
      }
    }
  }

  const toggleWorkspaceCollapsed = useCallback((workspaceId: string) => {
    setCollapsedWorkspaceIds((prev) => ({
      ...prev,
      [workspaceId]: !prev[workspaceId]
    }))
  }, [])

  const openThreadMenu = useCallback((sessionId: string, x: number, y: number) => {
    setConfirmDeleteSessionId(null)
    setThreadContextMenu({ sessionId, x, y })
  }, [])

  const toggleSessionSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }, [])

  const toggleWorkspaceSelection = useCallback((workspaceSessionIds: string[]) => {
    setSelectedSessionIds((prev) => {
      if (workspaceSessionIds.length === 0) return prev
      const next = new Set(prev)
      const shouldClear = workspaceSessionIds.every((id) => next.has(id))
      for (const id of workspaceSessionIds) {
        if (shouldClear) {
          next.delete(id)
        } else {
          next.add(id)
        }
      }
      return next
    })
  }, [])

  const toggleSelectVisible = useCallback(() => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev)
      const shouldClear = visibleSessionIds.length > 0 && visibleSessionIds.every((id) => next.has(id))
      for (const id of visibleSessionIds) {
        if (shouldClear) {
          next.delete(id)
        } else {
          next.add(id)
        }
      }
      return next
    })
  }, [visibleSessionIds])

  const handleRename = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.sessionId === sessionId)
      if (!session) return
      const nextTitle = window.prompt('Rename thread', session.title)
      if (!nextTitle || !nextTitle.trim()) return
      const trimmed = nextTitle.trim()
      if (trimmed === session.title) return
      await renameSession(sessionId, trimmed)
    },
    [sessions, renameSession]
  )

  const handleFork = useCallback(
    async (sessionId: string) => {
      try {
        await forkSession(sessionId)
      } catch (error) {
        console.error('Fork failed:', error)
      }
    },
    [forkSession]
  )

  const handleDeleteSession = useCallback(
    async (sessionId: string, cleanupWorktree: boolean) => {
      await deleteSession(sessionId, cleanupWorktree)
      setThreadContextMenu((current) => (current?.sessionId === sessionId ? null : current))
      setConfirmDeleteSessionId((current) => (current === sessionId ? null : current))
      setSelectedSessionIds((prev) => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    },
    [deleteSession]
  )

  const handleBulkDelete = useCallback(
    async (cleanupWorktree: boolean) => {
      if (selectedCount === 0 || bulkDeleting) return

      const message = cleanupWorktree
        ? `Delete ${selectedCount} selected thread${selectedCount === 1 ? '' : 's'} and clean up worktree files where available?`
        : `Delete ${selectedCount} selected thread${selectedCount === 1 ? '' : 's'}?`
      if (!window.confirm(message)) return

      const idsToDelete = selectedSessions.map((s) => s.sessionId)
      setBulkDeleting(true)
      try {
        await Promise.allSettled(idsToDelete.map((sessionId) => deleteSession(sessionId, cleanupWorktree)))
        setSelectedSessionIds((prev) => {
          const next = new Set(prev)
          for (const id of idsToDelete) {
            next.delete(id)
          }
          return next
        })
      } finally {
        setBulkDeleting(false)
      }
    },
    [bulkDeleting, deleteSession, selectedCount, selectedSessions]
  )

  useEffect(() => {
    const existingSessionIds = new Set(sessions.map((s) => s.sessionId))

    setSelectedSessionIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (existingSessionIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })

    if (threadContextMenu && !existingSessionIds.has(threadContextMenu.sessionId)) {
      setThreadContextMenu(null)
      setConfirmDeleteSessionId(null)
    }
  }, [sessions, threadContextMenu])

  useEffect(() => {
    if (!threadContextMenu) return
    const handleClick = () => {
      setThreadContextMenu(null)
      setConfirmDeleteSessionId(null)
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [threadContextMenu])

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-border gap-3 shrink-0">
        <button
          onClick={() => {
            closeThreadsOverview()
            navigate('home')
          }}
          className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
          title="Back"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-sm font-semibold text-text-primary">All Threads</h1>
        <span className="text-xs text-text-muted">
          {filteredAndSorted.length}{searchQuery ? ` of ${sessions.length}` : ''} threads
        </span>
        <div className="flex-1" />

        {/* Search input */}
        <div className="relative w-72">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search threads..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-2 border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-3 text-text-muted hover:text-text-primary"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-1/40">
        <span className="text-xs text-text-secondary">
          {selectedCount} selected
        </span>
        <button
          onClick={toggleSelectVisible}
          className="px-2 py-1 text-xs rounded bg-surface-2 border border-border text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors"
          title={allVisibleSelected ? 'Clear visible selection' : 'Select all visible threads'}
        >
          {allVisibleSelected ? 'Clear Visible' : 'Select Visible'}
        </button>
        <button
          onClick={() => setSelectedSessionIds(new Set())}
          className="px-2 py-1 text-xs rounded bg-surface-2 border border-border text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors"
          disabled={selectedCount === 0}
        >
          Clear Selection
        </button>
        <div className="flex-1" />
        <button
          onClick={() => void handleBulkDelete(false)}
          className="px-2 py-1 text-xs rounded bg-error/15 border border-error/40 text-error hover:bg-error/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={selectedCount === 0 || bulkDeleting}
        >
          Delete Selected
        </button>
        {selectedWithWorktreeCount > 0 && (
          <button
            onClick={() => void handleBulkDelete(true)}
            className="px-2 py-1 text-xs rounded bg-error/15 border border-error/40 text-error hover:bg-error/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={selectedCount === 0 || bulkDeleting}
          >
            Delete + Worktree
          </button>
        )}
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {filteredAndSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
            <svg className="w-12 h-12 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">
              {searchQuery ? 'No threads match your search' : 'No threads yet'}
            </p>
          </div>
        ) : (
          <div>
            {groupedByWorkspace.map(([workspaceId, workspaceSessions]) => {
              const workspaceName = workspaceMap.get(workspaceId) || 'Unknown Workspace'
              const isCollapsed = !!collapsedWorkspaceIds[workspaceId]
              const workspaceSessionIds = workspaceSessions.map((session) => session.sessionId)
              const selectedInWorkspace = workspaceSessionIds.filter((id) => selectedSessionIds.has(id)).length
              const allWorkspaceSelected = workspaceSessionIds.length > 0 && selectedInWorkspace === workspaceSessionIds.length
              const someWorkspaceSelected = selectedInWorkspace > 0 && !allWorkspaceSelected

              return (
                <section key={workspaceId} className="border-b border-border last:border-b-0">
                  <div className="sticky top-0 z-10 flex w-full items-center gap-2 px-4 py-2.5 bg-accent/8 backdrop-blur-sm border-b border-border border-l-2 border-l-accent/70 hover:bg-accent/12 transition-colors text-left">
                    <label
                      className="shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={allWorkspaceSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = someWorkspaceSelected
                        }}
                        onChange={() => toggleWorkspaceSelection(workspaceSessionIds)}
                        className="h-3.5 w-3.5 rounded border-border bg-surface-2 text-accent focus:ring-accent/40"
                        aria-label={`Select workspace ${workspaceName}`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => toggleWorkspaceCollapsed(workspaceId)}
                      className="flex flex-1 items-center gap-2 text-left"
                      aria-expanded={!isCollapsed}
                      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${workspaceName}`}
                    >
                      <svg
                        className={`w-3.5 h-3.5 shrink-0 text-accent transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      <svg className="w-3.5 h-3.5 shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <h2 className="text-sm font-semibold text-accent truncate">{workspaceName}</h2>
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-accent/15 text-accent shrink-0">
                        {workspaceSessions.length}
                      </span>
                    </button>
                  </div>
                  {!isCollapsed && (
                  <div className="divide-y divide-border">
                    {workspaceSessions.map((session) => {
                      const agentIcon = installedAgents.find(
                        (a) => a.registryId === session.agentId
                      )?.icon
                      const isDeleting = deletingSessionIds.has(session.sessionId)
                      const isSelected = selectedSessionIds.has(session.sessionId)
                      const isActive = activeSessionId === session.sessionId
                      const pendingCount = pendingCountBySession.get(session.sessionId) || 0
                      const lastActivity = getLastActivity(session)
                      const messageCount = session.messages.length
                      const preview = getMessagePreview(session)
                      const statusLabel = statusLabels[session.status] || session.status
                      const statusColor = statusColors[session.status] || statusColors.idle

                      return (
                        <div
                          key={session.sessionId}
                          className={`w-full px-4 py-3 transition-colors group flex items-start gap-2 ${
                            isActive
                              ? 'bg-surface-2 ring-1 ring-inset ring-accent'
                              : isSelected
                                ? 'bg-surface-2'
                                : 'hover:bg-surface-2 focus-within:bg-surface-2'
                          } ${isDeleting ? 'opacity-60 pointer-events-none' : ''}`}
                        >
                          <label
                            className="mt-1.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSessionSelection(session.sessionId)}
                              className="h-3.5 w-3.5 rounded border-border bg-surface-2 text-accent focus:ring-accent/40"
                              aria-label={`Select thread ${session.title}`}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => handleSelect(session.sessionId)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              openThreadMenu(session.sessionId, e.clientX, e.clientY)
                            }}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className="flex items-start gap-3">
                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-sm font-medium text-text-primary truncate">
                                    {session.title}
                                  </span>
                                  {pendingCount > 0 && (
                                    <span
                                      className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold bg-error text-white shrink-0"
                                      title={`${pendingCount} open permission ${pendingCount === 1 ? 'question' : 'questions'}`}
                                    >
                                      {pendingCount}
                                    </span>
                                  )}
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${statusColor}`}>
                                    {statusLabel}
                                  </span>
                                </div>

                                {/* Preview */}
                                <p className="text-xs text-text-secondary truncate mb-1.5">
                                  {preview}
                                </p>

                                {/* Metadata row */}
                                <div className="flex items-center gap-3 text-[11px] text-text-muted">
                                  <span className="flex items-center gap-1 shrink-0">
                                    <AgentIcon
                                      agentId={session.agentId}
                                      icon={agentIcon}
                                      name={session.agentName}
                                      size="sm"
                                      className="w-3 h-3"
                                    />
                                    {session.agentName}
                                  </span>
                                  {session.worktreeBranch && (
                                    <span className="flex items-center gap-1 truncate">
                                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                      </svg>
                                      <span className="truncate">{session.worktreeBranch}</span>
                                    </span>
                                  )}
                                  <span className="shrink-0">
                                    {messageCount} {messageCount === 1 ? 'message' : 'messages'}
                                  </span>
                                  <span className="shrink-0 ml-auto">
                                    {formatRelativeTime(lastActivity)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const rect = e.currentTarget.getBoundingClientRect()
                              const menuWidth = 208
                              openThreadMenu(session.sessionId, Math.max(8, rect.right - menuWidth), rect.bottom + 4)
                            }}
                            className="mt-0.5 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text-primary hover:bg-surface-2"
                            title="Thread options"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
                            </svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      {threadContextMenu && contextSession && (
        <div
          className="fixed z-50 w-52 rounded-lg bg-surface-2 border border-border shadow-lg shadow-black/40 py-1.5"
          style={{ left: threadContextMenu.x, top: threadContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextSession.status !== 'prompting' &&
            contextSession.status !== 'creating' &&
            contextSession.status !== 'initializing' && (
            <button
              onClick={() => {
                void handleFork(contextSession.sessionId)
                setThreadContextMenu(null)
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
            >
              Fork Thread
            </button>
          )}
          <button
            onClick={() => {
              void handleRename(contextSession.sessionId)
              setThreadContextMenu(null)
            }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
          >
            Rename
          </button>
          {contextSession.worktreePath && (
            <button
              onClick={() => {
                void openInVSCode(contextSession.worktreePath!)
                setThreadContextMenu(null)
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
            >
              Open in VS Code
            </button>
          )}
          {confirmDeleteSessionId === contextSession.sessionId ? (
            <div className="border-t border-border mt-1 pt-1">
              {contextSession.worktreePath ? (
                <>
                  <button
                    onClick={() => void handleDeleteSession(contextSession.sessionId, false)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-primary"
                  >
                    Delete thread only
                  </button>
                  <button
                    onClick={() => void handleDeleteSession(contextSession.sessionId, true)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/20 text-error"
                  >
                    Delete thread + worktree
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void handleDeleteSession(contextSession.sessionId, false)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/20 text-error"
                >
                  Confirm delete
                </button>
              )}
              <button
                onClick={() => setConfirmDeleteSessionId(null)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 text-text-muted"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteSessionId(contextSession.sessionId)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/20 text-error"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}
