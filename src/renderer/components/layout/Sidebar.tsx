import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSessionStore } from '../../stores/session-store'
import { WorkspaceSection } from '../sidebar/WorkspaceSection'
import { Button } from '../common/Button'
import type { InteractionMode } from '@shared/types/session'

function SidebarSearch() {
  const [query, setQuery] = useState('')
  const openThreadsOverview = useUiStore((s) => s.openThreadsOverview)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      openThreadsOverview(query.trim())
      setQuery('')
    }
  }

  const handleClick = () => {
    openThreadsOverview(query.trim())
    setQuery('')
  }

  return (
    <div className="px-3 pb-2">
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
          placeholder="Search threads..."
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-2 border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50"
        />
      </div>
    </div>
  )
}

function isInteractionMode(value: string): value is InteractionMode {
  return value === 'ask' || value === 'code' || value === 'plan' || value === 'act'
}

export function Sidebar() {
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const { workspaces, createWorkspace } = useWorkspaceStore()
  const sessions = useSessionStore((s) => s.sessions)
  const startDraftThread = useSessionStore((s) => s.startDraftThread)
  const pendingPermissionCount = useSessionStore((s) => s.pendingPermissions.length)
  const [isResizing, setIsResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const sortedWorkspaces = [...workspaces].sort((a, b) =>
    b.lastAccessedAt.localeCompare(a.lastAccessedAt)
  )

  const handleNewThread = async () => {
    const { updateDraftThread } = useSessionStore.getState()
    if (sortedWorkspaces.length > 0) {
      // Start a draft on the most recently accessed workspace
      const topWorkspace = sortedWorkspaces[0]
      startDraftThread(topWorkspace.id, topWorkspace.path)
      if (
        topWorkspace.defaultAgentId ||
        topWorkspace.defaultModelId ||
        topWorkspace.defaultInteractionMode ||
        topWorkspace.defaultUseWorktree !== undefined
      ) {
        updateDraftThread({
          agentId: topWorkspace.defaultAgentId || null,
          modelId: topWorkspace.defaultModelId || null,
          interactionMode: topWorkspace.defaultInteractionMode || null,
          useWorktree: !!topWorkspace.defaultUseWorktree
        })
      }
      try {
        const config = await window.api.invoke('workspace:get-config', { workspacePath: topWorkspace.path })
        if (config?.defaults) {
          updateDraftThread({
            agentId: config.defaults.agentId || topWorkspace.defaultAgentId || null,
            modelId: config.defaults.modelId || topWorkspace.defaultModelId || null,
            interactionMode:
              (config.defaults.interactionMode && isInteractionMode(config.defaults.interactionMode)
                ? config.defaults.interactionMode
                : topWorkspace.defaultInteractionMode) || null,
            useWorktree: config.defaults.useWorktree ?? topWorkspace.defaultUseWorktree ?? false
          })
        }
      } catch (err) {
        console.error('Failed to load workspace defaults from config:', err)
      }
    } else {
      // No workspaces — pick a directory and create one
      const path = await window.api.invoke('workspace:select-directory', undefined)
      if (!path) return
      try {
        const ws = await createWorkspace(path)
        startDraftThread(ws.id, ws.path)
        if (
          ws.defaultAgentId ||
          ws.defaultModelId ||
          ws.defaultInteractionMode ||
          ws.defaultUseWorktree !== undefined
        ) {
          updateDraftThread({
            agentId: ws.defaultAgentId || null,
            modelId: ws.defaultModelId || null,
            interactionMode: ws.defaultInteractionMode || null,
            useWorktree: !!ws.defaultUseWorktree
          })
        }
        try {
          const config = await window.api.invoke('workspace:get-config', { workspacePath: ws.path })
          if (config?.defaults) {
            updateDraftThread({
              agentId: config.defaults.agentId || ws.defaultAgentId || null,
              modelId: config.defaults.modelId || ws.defaultModelId || null,
              interactionMode:
                (config.defaults.interactionMode && isInteractionMode(config.defaults.interactionMode)
                  ? config.defaults.interactionMode
                  : ws.defaultInteractionMode) || null,
              useWorktree: config.defaults.useWorktree ?? ws.defaultUseWorktree ?? false
            })
          }
        } catch (err) {
          console.error('Failed to load workspace defaults from config:', err)
        }
      } catch (err) {
        console.error('Failed to create workspace:', err)
      }
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

  if (!sidebarVisible) return null

  return (
    <div
      className="relative flex flex-col bg-surface-1 border-r border-border shrink-0 h-full"
      style={{ width: sidebarWidth }}
    >
      {/* New thread button */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={handleNewThread}
          >
            <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Thread
          </Button>

          {pendingPermissionCount > 0 && (
            <div className="absolute -top-1.5 -right-1.5 flex items-center gap-1 rounded-full bg-error px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              {pendingPermissionCount}
            </div>
          )}
        </div>

        {pendingPermissionCount > 0 && (
          <div className="mt-2 text-[11px] text-error flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-error animate-pulse" />
            {pendingPermissionCount} open permission {pendingPermissionCount === 1 ? 'question' : 'questions'}
          </div>
        )}
      </div>

      {/* Search */}
      <SidebarSearch />

      {/* Workspace sections */}
      <div className="flex-1 overflow-y-auto">
        {sortedWorkspaces.length === 0 ? (
          <div className="p-4 text-center text-xs text-text-muted">
            No workspaces yet. Create a thread to add one.
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
