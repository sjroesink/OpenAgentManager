import React, { useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { Button } from '../common/Button'

export function WorkspaceStep() {
  const { workspaces, createWorkspace } = useWorkspaceStore()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const handleSelectDirectory = async () => {
    try {
      const path = await window.api.invoke('workspace:select-directory', undefined)
      if (path) {
        setSelectedPath(path)
        setError(null)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleCreateWorkspace = async () => {
    if (!selectedPath) return
    setCreating(true)
    setError(null)
    try {
      await createWorkspace(selectedPath)
      setCreated(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const alreadyExists = selectedPath
    ? workspaces.some((w) => w.path === selectedPath)
    : false

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-text-primary mb-2">Add a Workspace</h2>
      <p className="text-sm text-text-secondary mb-6">
        A workspace is a project directory where you&apos;ll use your agents.
        Pick a folder to get started — you can add more workspaces later.
      </p>

      <div className="border border-border rounded-lg p-6 bg-surface-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Project Directory</h3>
            <p className="text-xs text-text-secondary">
              Choose a folder containing your project code
            </p>
          </div>
        </div>

        {selectedPath ? (
          <div className="mb-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-1 rounded-md border border-border">
              <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="text-sm text-text-primary truncate">{selectedPath}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectDirectory}
                className="ml-auto shrink-0"
              >
                Change
              </Button>
            </div>
            {alreadyExists && (
              <p className="text-xs text-text-muted mt-1.5">
                This directory is already a workspace.
              </p>
            )}
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={handleSelectDirectory}
            className="mb-4"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Select Directory
          </Button>
        )}

        {selectedPath && !alreadyExists && !created && (
          <Button
            variant="primary"
            loading={creating}
            onClick={handleCreateWorkspace}
          >
            Create Workspace
          </Button>
        )}

        {(created || alreadyExists) && (
          <div className="p-3 border border-success/30 rounded-lg bg-success/5">
            <p className="text-sm text-success font-medium">
              Workspace ready
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              You can start a new thread in this workspace after completing setup.
            </p>
          </div>
        )}

        {error && (
          <p className="text-xs text-error mt-3">{error}</p>
        )}
      </div>

      <p className="text-xs text-text-muted mt-4">
        You can add more workspaces any time from the sidebar.
      </p>
    </div>
  )
}
