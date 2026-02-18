import React, { useState, useCallback, useEffect } from 'react'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSessionStore } from '../../stores/session-store'
import { useAgentStore } from '../../stores/agent-store'
import { useUiStore } from '../../stores/ui-store'
import { AgentSelector } from './AgentSelector'
import { ModelPicker } from '../common/ModelPicker'
import { Dialog } from '../common/Dialog'
import { Button } from '../common/Button'
import type { InstalledAgent } from '@shared/types/agent'

export function NewThreadDialog() {
  const open = useUiStore((s) => s.newThreadDialogOpen)
  const setOpen = useUiStore((s) => s.setNewThreadDialogOpen)
  const { workspaces, createWorkspace } = useWorkspaceStore()
  const { connections, launchAgent } = useAgentStore()
  const { createSession } = useSessionStore()

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [useWorktree, setUseWorktree] = useState(false)
  const [availableBranches, setAvailableBranches] = useState<string[]>([])
  const [selectedBaseBranch, setSelectedBaseBranch] = useState('')
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [branchLoadError, setBranchLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId)

  useEffect(() => {
    if (selectedWorkspace) {
      // First apply from metadata (fast)
      if (selectedWorkspace.defaultAgentId) {
        setSelectedAgentId(selectedWorkspace.defaultAgentId)
      }
      if (selectedWorkspace.defaultModelId) {
        setSelectedModelId(selectedWorkspace.defaultModelId)
      }
      if (selectedWorkspace.defaultUseWorktree !== undefined) {
        setUseWorktree(selectedWorkspace.defaultUseWorktree)
      }
      // Then try to fetch from config file (shared)
      window.api
        .invoke('workspace:get-config', { workspacePath: selectedWorkspace.path })
        .then((config) => {
          if (config?.defaults) {
            if (config.defaults.agentId) setSelectedAgentId(config.defaults.agentId)
            if (config.defaults.modelId) setSelectedModelId(config.defaults.modelId)
            if (config.defaults.useWorktree !== undefined) setUseWorktree(config.defaults.useWorktree)
          }
        })
        .catch((err) => console.error('Failed to load workspace defaults from config:', err))
    }
  }, [selectedWorkspaceId, selectedWorkspace])

  useEffect(() => {
    if (!open) return
    if (!selectedWorkspace?.isGitRepo || !useWorktree) {
      setAvailableBranches([])
      setSelectedBaseBranch('')
      setBranchLoadError(null)
      setBranchesLoading(false)
      return
    }

    let cancelled = false
    setBranchesLoading(true)
    setBranchLoadError(null)

    window.api
      .invoke('git:list-branches', { projectPath: selectedWorkspace.path })
      .then((branches) => {
        if (cancelled) return
        setAvailableBranches(branches)
        setSelectedBaseBranch((current) => {
          if (current && branches.includes(current)) return current
          return branches[0] || ''
        })
      })
      .catch((err) => {
        if (cancelled) return
        setBranchLoadError(err instanceof Error ? err.message : 'Failed to load branches')
        setAvailableBranches([])
        setSelectedBaseBranch('')
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, selectedWorkspace?.id, selectedWorkspace?.path, selectedWorkspace?.isGitRepo, useWorktree])

  const handleSelectNewWorkspace = useCallback(async () => {
    const path = await window.api.invoke('workspace:select-directory', undefined)
    if (!path) return

    try {
      const workspace = await createWorkspace(path)
      setSelectedWorkspaceId(workspace.id)
    } catch (error) {
      console.error('Failed to create workspace:', error)
    }
  }, [createWorkspace])

  const handleAgentSelect = useCallback((agent: InstalledAgent) => {
    setSelectedAgentId(agent.registryId)
    setSelectedModelId(null)
  }, [])

  const handleCreate = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedAgentId || !selectedWorkspace) return
    setCreating(true)

    // Close dialog immediately for faster perceived performance
    const agentId = selectedAgentId
    const modelId = selectedModelId
    const workspace = selectedWorkspace
    const workspaceId = selectedWorkspaceId
    const worktree = useWorktree
    const baseBranch = worktree ? (selectedBaseBranch || undefined) : undefined

    setOpen(false)
    setSelectedWorkspaceId(null)
    setSelectedAgentId(null)
    setSelectedModelId(null)
    setUseWorktree(false)
    setAvailableBranches([])
    setSelectedBaseBranch('')
    setBranchLoadError(null)

    try {
      let connection = connections.find(
        (c) => c.agentId === agentId && c.status === 'connected'
      )

      if (!connection) {
        connection = await launchAgent(agentId, workspace.path)
      }

      await createSession(
        connection.connectionId,
        workspace.path,
        worktree,
        workspaceId,
        undefined,
        modelId || undefined,
        undefined,
        baseBranch
      )
    } catch (error) {
      console.error('Failed to create thread:', error)
    } finally {
      setCreating(false)
    }
  }, [
    selectedWorkspaceId,
    selectedAgentId,
    selectedWorkspace,
    connections,
    launchAgent,
    createSession,
    selectedModelId,
    useWorktree,
    selectedBaseBranch,
    setOpen
  ])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  return (
    <Dialog open={open} onClose={handleClose} title="New Thread">
      <div className="space-y-4">
        {/* Workspace selector */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Workspace
          </label>
          <div className="space-y-2">
            <select
              value={selectedWorkspaceId || ''}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  handleSelectNewWorkspace()
                } else {
                  setSelectedWorkspaceId(e.target.value || null)
                  setUseWorktree(false)
                  setAvailableBranches([])
                  setSelectedBaseBranch('')
                  setBranchLoadError(null)
                }
              }}
              className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Select workspace...</option>
              {workspaces
                .sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              <option value="__new__">+ New workspace...</option>
            </select>
            {selectedWorkspace && (
              <div className="text-xs text-text-muted truncate px-1">
                {selectedWorkspace.path}
              </div>
            )}
          </div>
        </div>

        {/* Agent selector */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Agent
          </label>
          <AgentSelector selectedAgentId={selectedAgentId} onSelect={handleAgentSelect} />
        </div>

        <ModelPicker
          agentId={selectedAgentId}
          projectPath={selectedWorkspace?.path || ''}
          value={selectedModelId}
          onChange={setSelectedModelId}
          emptyLabel="Default model"
        />

        {/* Worktree toggle */}
        {selectedWorkspace?.isGitRepo && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWorktree}
                  onChange={(e) => {
                    const enabled = e.target.checked
                    setUseWorktree(enabled)
                    if (!enabled) {
                      setSelectedBaseBranch('')
                    }
                  }}
                  className="rounded border-border"
                />
                Use git worktree
              </label>
            </div>

            {useWorktree && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Base branch
                </label>
                <select
                  value={selectedBaseBranch}
                  onChange={(e) => setSelectedBaseBranch(e.target.value)}
                  disabled={branchesLoading || availableBranches.length === 0}
                  className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                >
                  <option value="">
                    {branchesLoading
                      ? 'Loading branches...'
                      : availableBranches.length === 0
                        ? 'No branches found'
                        : 'Select base branch'}
                  </option>
                  {availableBranches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
                {branchLoadError && (
                  <p className="text-[11px] text-error mt-1">{branchLoadError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Create button */}
        <div className="pt-2">
          <Button
            variant="primary"
            className="w-full"
            disabled={!selectedWorkspaceId || !selectedAgentId || creating}
            loading={creating}
            onClick={handleCreate}
          >
            Create Thread
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
