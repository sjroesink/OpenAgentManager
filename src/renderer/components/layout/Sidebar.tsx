import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSessionStore } from '../../stores/session-store'
import { useRouteStore } from '../../stores/route-store'
import { WorkspaceSection } from '../sidebar/WorkspaceSection'
import { Button } from '../common/Button'

export function Sidebar() {
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const { workspaces, createWorkspace } = useWorkspaceStore()
  const sessions = useSessionStore((s) => s.sessions)
  const startDraftThread = useSessionStore((s) => s.startDraftThread)
  const pendingPermissionCount = useSessionStore((s) => s.pendingPermissions.length)
  const openThreadsOverview = useUiStore((s) => s.openThreadsOverview)
  const navigate = useRouteStore((s) => s.navigate)
  const [isResizing, setIsResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt)),
    [workspaces]
  )

  const handleNewThread = async () => {
    const { draftThread, setActiveDraft, updateDraftThread } = useSessionStore.getState()
    if (draftThread) {
      setActiveDraft(draftThread.id)
      navigate('new-thread', { draftId: draftThread.id })
      return
    }

    if (sortedWorkspaces.length > 0) {
      // Start a draft on the most recently accessed workspace
      const topWorkspace = sortedWorkspaces[0]
      startDraftThread(topWorkspace.id, topWorkspace.path)
      const draftId = useSessionStore.getState().draftThread?.id
      if (draftId) {
        navigate('new-thread', { draftId })
      }
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
      const baselineDraft = useSessionStore.getState().draftThread
      try {
        const config = await window.api.invoke('workspace:get-config', { workspacePath: topWorkspace.path })
        if (config?.defaults) {
          const currentDraft = useSessionStore.getState().draftThread
          if (!currentDraft || currentDraft.id !== draftId) return

          updateDraftThread({
            agentId:
              currentDraft.agentId === baselineDraft?.agentId
                ? config.defaults.agentId || topWorkspace.defaultAgentId || null
                : currentDraft.agentId,
            modelId:
              currentDraft.modelId === baselineDraft?.modelId
                ? config.defaults.modelId || topWorkspace.defaultModelId || null
                : currentDraft.modelId,
            interactionMode:
              currentDraft.interactionMode === baselineDraft?.interactionMode
                ? config.defaults.interactionMode || topWorkspace.defaultInteractionMode || null
                : currentDraft.interactionMode,
            useWorktree:
              currentDraft.useWorktree === baselineDraft?.useWorktree
                ? config.defaults.useWorktree ?? topWorkspace.defaultUseWorktree ?? false
                : currentDraft.useWorktree
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
        const draftId = useSessionStore.getState().draftThread?.id
        if (draftId) {
          navigate('new-thread', { draftId })
        }
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
        const baselineDraft = useSessionStore.getState().draftThread
        try {
          const config = await window.api.invoke('workspace:get-config', { workspacePath: ws.path })
          if (config?.defaults) {
            const currentDraft = useSessionStore.getState().draftThread
            if (!currentDraft || currentDraft.id !== draftId) return

            updateDraftThread({
              agentId:
                currentDraft.agentId === baselineDraft?.agentId
                  ? config.defaults.agentId || ws.defaultAgentId || null
                  : currentDraft.agentId,
              modelId:
                currentDraft.modelId === baselineDraft?.modelId
                  ? config.defaults.modelId || ws.defaultModelId || null
                  : currentDraft.modelId,
              interactionMode:
                currentDraft.interactionMode === baselineDraft?.interactionMode
                  ? config.defaults.interactionMode || ws.defaultInteractionMode || null
                  : currentDraft.interactionMode,
              useWorktree:
                currentDraft.useWorktree === baselineDraft?.useWorktree
                  ? config.defaults.useWorktree ?? ws.defaultUseWorktree ?? false
                  : currentDraft.useWorktree
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

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" className="w-full" onClick={handleOpenThreads}>
            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18" />
            </svg>
            Threads
          </Button>
          <Button variant="secondary" size="sm" className="w-full" onClick={handleOpenSearchThreads}>
            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
