import React from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSessionStore } from '../../stores/session-store'
import { WorkspaceSection } from '../sidebar/WorkspaceSection'
import { Button } from '../common/Button'

export function Sidebar() {
  const { sidebarVisible, sidebarWidth } = useUiStore()
  const { workspaces, createWorkspace } = useWorkspaceStore()
  const sessions = useSessionStore((s) => s.sessions)
  const startDraftThread = useSessionStore((s) => s.startDraftThread)

  if (!sidebarVisible) return null

  const sortedWorkspaces = [...workspaces].sort((a, b) =>
    b.lastAccessedAt.localeCompare(a.lastAccessedAt)
  )

  const handleNewThread = async () => {
    if (sortedWorkspaces.length > 0) {
      // Start a draft on the most recently accessed workspace
      const topWorkspace = sortedWorkspaces[0]
      startDraftThread(topWorkspace.id, topWorkspace.path)
    } else {
      // No workspaces — pick a directory and create one
      const path = await window.api.invoke('workspace:select-directory', undefined)
      if (!path) return
      try {
        const ws = await createWorkspace(path)
        startDraftThread(ws.id, ws.path)
      } catch (err) {
        console.error('Failed to create workspace:', err)
      }
    }
  }

  return (
    <div
      className="flex flex-col bg-surface-1 border-r border-border shrink-0 h-full"
      style={{ width: sidebarWidth }}
    >
      {/* New thread button */}
      <div className="p-3 border-b border-border">
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
    </div>
  )
}
