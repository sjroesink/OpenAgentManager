import React, { useState, useCallback } from 'react'
import { useSessionStore, type DraftThread } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { AgentSelector } from '../sidebar/AgentSelector'
import { ModelPicker } from '../common/ModelPicker'
import { Button } from '../common/Button'
import type { InstalledAgent } from '@shared/types/agent'
import type { InteractionMode } from '@shared/types/session'

function isInteractionMode(value: string): value is InteractionMode {
  return value === 'ask' || value === 'code' || value === 'plan' || value === 'act'
}

interface DraftThreadViewProps {
  draft: DraftThread
}

export function DraftThreadView({ draft }: DraftThreadViewProps) {
  const { updateDraftThread, commitDraftThread, discardDraftThread } = useSessionStore()
  const { workspaces, createWorkspace } = useWorkspaceStore()
  const workspace = workspaces.find((w) => w.id === draft.workspaceId)

  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canCreate = !!draft.agentId && !creating

  const handleWorkspaceChange = useCallback(
    async (value: string) => {
      if (value === '__new__') {
        const path = await window.api.invoke('workspace:select-directory', undefined)
        if (!path) return
        try {
          const ws = await createWorkspace(path)
          updateDraftThread({ workspaceId: ws.id, workspacePath: ws.path, useWorktree: false })
          
          // Apply defaults for new workspace
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

          // Then try to fetch from config file (shared)
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
      } else {
        const ws = workspaces.find((w) => w.id === value)
        if (ws) {
          updateDraftThread({ workspaceId: ws.id, workspacePath: ws.path, useWorktree: false })
          
          // Apply defaults from metadata
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

          // Then try to fetch from config file (shared)
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
        }
      }
    },
    [workspaces, createWorkspace, updateDraftThread]
  )

  const handleAgentSelect = useCallback(
    (agent: InstalledAgent) => {
      updateDraftThread({ agentId: agent.registryId, modelId: null })
    },
    [updateDraftThread]
  )

  const handleCreateThread = useCallback(async () => {
    if (!canCreate) return
    setCreating(true)
    setError(null)
    try {
      await commitDraftThread()
    } catch (err) {
      setError((err as Error).message || 'Failed to create thread')
      setCreating(false)
    }
  }, [canCreate, commitDraftThread])

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center px-4 py-2 border-b border-border gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
          <span className="text-sm font-medium text-accent">New Thread</span>
          {workspace && (
            <span className="text-xs text-text-muted truncate">{workspace.name}</span>
          )}
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={discardDraftThread}>
          Cancel
        </Button>
      </div>

      {/* Config + message area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-xl space-y-5">
          {/* Workspace selector */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Workspace
            </label>
            <select
              value={draft.workspaceId}
              onChange={(e) => handleWorkspaceChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-1 border border-border rounded-md text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {[...workspaces]
                .sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              <option value="__new__">+ New workspace...</option>
            </select>
            {workspace && (
              <div className="text-xs text-text-muted truncate mt-1 px-1">
                {workspace.path}
              </div>
            )}
          </div>

          {/* Agent selector */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Agent
            </label>
            <AgentSelector selectedAgentId={draft.agentId} onSelect={handleAgentSelect} />
          </div>

          <ModelPicker
            agentId={draft.agentId}
            projectPath={draft.workspacePath}
            value={draft.modelId}
            onChange={(modelId) => updateDraftThread({ modelId })}
            emptyLabel="Default model"
          />

          {/* Worktree toggle */}
          {workspace?.isGitRepo && (
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={draft.useWorktree}
                onChange={(e) => updateDraftThread({ useWorktree: e.target.checked })}
                className="rounded border-border"
              />
              Use git worktree
            </label>
          )}

          {/* Thread creation */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Start chat
            </label>
            <div className="bg-surface-1 border border-border rounded-xl p-4">
              <p className="text-xs text-text-muted mb-3">
                Create the thread first. Then you can use the full chat input to select a model
                and attach images before sending your first message.
              </p>
              <Button
                variant="primary"
                size="md"
                disabled={!canCreate}
                loading={creating}
                onClick={handleCreateThread}
                className="w-full"
              >
                Create Thread
              </Button>
            </div>

            {error && (
              <p className="text-xs text-error mt-1.5">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
