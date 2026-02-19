import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSessionStore } from '../../stores/session-store'
import { useRouteStore } from '../../stores/route-store'
import { useAgentStore } from '../../stores/agent-store'
import { WorkspaceSection } from '../sidebar/WorkspaceSection'
import { AgentIcon } from '../common/AgentIcon'
import { Button } from '../common/Button'
import type { InstalledAgent } from '@shared/types/agent'

export function Sidebar() {
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const { workspaces, createWorkspace } = useWorkspaceStore()
  const sessions = useSessionStore((s) => s.sessions)
  const pendingPermissionCount = useSessionStore((s) => s.pendingPermissions.length)
  const openThreadsOverview = useUiStore((s) => s.openThreadsOverview)
  const navigate = useRouteStore((s) => s.navigate)
  const installedAgents = useAgentStore((s) => s.installed)
  const [isResizing, setIsResizing] = useState(false)
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt)),
    [workspaces]
  )

  useEffect(() => {
    if (!agentDropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [agentDropdownOpen])

  const handleNewThreadWithAgent = async (agent: InstalledAgent) => {
    setAgentDropdownOpen(false)

    let workspaceToUse = sortedWorkspaces[0]
    if (!workspaceToUse) {
      const path = await window.api.invoke('workspace:select-directory', undefined)
      if (!path) return
      try {
        workspaceToUse = await createWorkspace(path)
      } catch (err) {
        console.error('Failed to create workspace:', err)
        return
      }
    }

    const { startDraftThread, updateDraftThread, commitDraftThread } = useSessionStore.getState()
    startDraftThread(workspaceToUse.id, workspaceToUse.path)
    updateDraftThread({
      agentId: agent.registryId,
      modelId: workspaceToUse.defaultModelId || null,
      interactionMode: workspaceToUse.defaultInteractionMode || null,
      useWorktree: !!workspaceToUse.defaultUseWorktree
    })
    commitDraftThread()
    navigate('home')
  }

  const handleNewThread = async () => {
    if (installedAgents.length === 0) {
      navigate('agents')
      return
    }
    if (installedAgents.length === 1) {
      await handleNewThreadWithAgent(installedAgents[0])
      return
    }
    setAgentDropdownOpen((prev) => !prev)
  }

  const handleNewWorkspace = async () => {
    const path = await window.api.invoke('workspace:select-directory', undefined)
    if (!path) return
    try {
      await createWorkspace(path)
    } catch (err) {
      console.error('Failed to create workspace:', err)
    }
  }

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    startXRef.current = event.clientX
    startWidthRef.current = sidebarWidth
    setIsResizing(true)
  }, [sidebarWidth])

  useEffect(() => {
    if (!isResizing) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - startXRef.current
      setSidebarWidth(startWidthRef.current + deltaX)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setSidebarWidth])

  const handleOpenThreads = () => {
    openThreadsOverview()
    navigate('threads')
  }

  const handleOpenSearchThreads = () => {
    openThreadsOverview('', true)
    navigate('threads')
  }

  if (!sidebarVisible) return null

  return (
    <div
      className="relative flex flex-col bg-surface-1 border-r border-border shrink-0 h-full"
      style={{ width: sidebarWidth }}
    >
      {/* Header actions */}
      <div className="p-3 border-b border-border">
        {/* New Thread dropdown button */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={handleNewThread}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-accent hover:bg-accent-hover text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="flex-1 text-left">New Thread</span>
            {installedAgents.length > 1 && (
              <svg className="w-3 h-3 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>

          {agentDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface-2 border border-border rounded-md shadow-xl z-50 overflow-hidden">
              {installedAgents.map((agent) => (
                <button
                  key={agent.registryId}
                  onClick={() => handleNewThreadWithAgent(agent)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-3 text-text-primary transition-colors"
                >
                  <AgentIcon
                    agentId={agent.registryId}
                    icon={agent.icon}
                    name={agent.name}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{agent.name}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {pendingPermissionCount > 0 && (
          <div className="mt-2 text-[11px] text-error flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-error animate-pulse" />
            {pendingPermissionCount} open permission {pendingPermissionCount === 1 ? 'question' : 'questions'}
          </div>
        )}

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Button variant="secondary" size="sm" className="w-full" onClick={handleNewWorkspace} title="New Workspace">
            <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Folder
          </Button>
          <Button variant="secondary" size="sm" className="w-full" onClick={handleOpenThreads}>
            <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18" />
            </svg>
            Threads
          </Button>
          <Button variant="secondary" size="sm" className="w-full" onClick={handleOpenSearchThreads}>
            <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Search
          </Button>
        </div>
      </div>

      {/* Workspace sections */}
      <div className="flex-1 overflow-y-auto">
        {sortedWorkspaces.length === 0 ? (
          <div className="p-4 text-center text-xs text-text-muted">
            No workspaces yet. Click "Folder" to add one.
          </div>
        ) : (
          <div className="py-1">
            {sortedWorkspaces.map((workspace) => (
              <WorkspaceSection
                key={workspace.id}
                workspace={workspace}
                sessions={sessions.filter((s) => s.workspaceId === workspace.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div
        className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize transition-colors ${
          isResizing ? 'bg-accent/40' : 'hover:bg-accent/30'
        }`}
        onMouseDown={handleResizeStart}
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
      />
    </div>
  )
}
