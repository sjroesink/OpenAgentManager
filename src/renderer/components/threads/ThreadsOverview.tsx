import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useAgentStore } from '../../stores/agent-store'
import { useUiStore } from '../../stores/ui-store'
import { useRouteStore } from '../../stores/route-store'
import { AgentIcon } from '../common/AgentIcon'
import type { SessionInfo } from '@shared/types/session'

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
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const pendingPermissions = useSessionStore((s) => s.pendingPermissions)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const installedAgents = useAgentStore((s) => s.installed)
  const searchQuery = useUiStore((s) => s.threadsOverviewSearchQuery)
  const shouldFocusSearch = useUiStore((s) => s.threadsOverviewFocusSearch)
  const setSearchQuery = useUiStore((s) => s.setThreadsOverviewSearchQuery)
  const closeThreadsOverview = useUiStore((s) => s.closeThreadsOverview)
  const navigate = useRouteStore((s) => s.navigate)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({})

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
              return (
                <section key={workspaceId} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleWorkspaceCollapsed(workspaceId)}
                    className="sticky top-0 z-10 flex w-full items-center gap-2 px-4 py-2.5 bg-accent/8 backdrop-blur-sm border-b border-border border-l-2 border-l-accent/70 hover:bg-accent/12 transition-colors text-left"
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
                  {!isCollapsed && (
                  <div className="divide-y divide-border">
                    {workspaceSessions.map((session) => {
                      const agentIcon = installedAgents.find(
                        (a) => a.registryId === session.agentId
                      )?.icon
                      const pendingCount = pendingCountBySession.get(session.sessionId) || 0
                      const lastActivity = getLastActivity(session)
                      const messageCount = session.messages.length
                      const preview = getMessagePreview(session)
                      const statusLabel = statusLabels[session.status] || session.status
                      const statusColor = statusColors[session.status] || statusColors.idle

                      return (
                        <button
                          key={session.sessionId}
                          onClick={() => handleSelect(session.sessionId)}
                          className="w-full text-left px-4 py-3 hover:bg-surface-1 transition-colors group"
                        >
                          <div className="flex items-start gap-3">
                            {/* Agent icon */}
                            <div className="relative shrink-0 mt-0.5">
                              <AgentIcon
                                agentId={session.agentId}
                                icon={agentIcon}
                                name={session.agentName}
                                size="md"
                              />
                              {pendingCount > 0 && (
                                <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-error text-[8px] font-bold text-white">
                                  {pendingCount}
                                </span>
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-medium text-text-primary truncate">
                                  {session.title}
                                </span>
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
    </div>
  )
}
