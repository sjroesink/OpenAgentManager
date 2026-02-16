import React, { useState, useEffect, useCallback } from 'react'
import { useAgentStore } from '../../stores/agent-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { Dialog } from '../common/Dialog'
import { Button } from '../common/Button'
import { ModelPicker } from '../common/ModelPicker'
import type { AgentProjectConfig, WorktreeHooksConfig, SymlinkEntry, PostSetupCommand } from '@shared/types/thread-format'
import type { InteractionMode } from '@shared/types/session'

function isInteractionMode(value: string): value is InteractionMode {
  return value === 'ask' || value === 'code' || value === 'plan' || value === 'act'
}

interface WorkspaceSettingsDialogProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  workspacePath: string
  workspaceName: string
  defaultAgentId?: string
  defaultModelId?: string
  defaultInteractionMode?: InteractionMode
  defaultUseWorktree?: boolean
}

export function WorkspaceSettingsDialog({
  open,
  onClose,
  workspaceId,
  workspacePath,
  workspaceName,
  defaultAgentId: initialDefaultAgentId,
  defaultModelId: initialDefaultModelId,
  defaultInteractionMode: initialDefaultInteractionMode,
  defaultUseWorktree: initialDefaultUseWorktree
}: WorkspaceSettingsDialogProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [symlinks, setSymlinks] = useState<SymlinkEntry[]>([])
  const [commands, setCommands] = useState<PostSetupCommand[]>([])
  const [initialPrompt, setInitialPrompt] = useState('')
  const [defaultAgentId, setDefaultAgentId] = useState(initialDefaultAgentId || '')
  const [defaultModelId, setDefaultModelId] = useState(initialDefaultModelId || '')
  const [defaultInteractionMode, setDefaultInteractionMode] = useState<InteractionMode>(initialDefaultInteractionMode || 'ask')
  const [useWorktree, setUseWorktree] = useState(initialDefaultUseWorktree || false)
  const [fullConfig, setFullConfig] = useState<AgentProjectConfig | null>(null)
  const installedAgents = useAgentStore((s) => s.installed)
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    window.api
      .invoke('workspace:get-config', { workspacePath })
      .then((config) => {
        setFullConfig(config)
        const hooks = config?.worktreeHooks
        setSymlinks(hooks?.symlinks || [])
        setCommands(hooks?.postSetupCommands || [])
        setInitialPrompt(hooks?.initialPrompt || '')
        
        // If config file has defaults, they override the workspace metadata
        if (config?.defaults?.agentId) setDefaultAgentId(config.defaults.agentId)
        if (config?.defaults?.modelId) setDefaultModelId(config.defaults.modelId)
        if (config?.defaults?.interactionMode && isInteractionMode(config.defaults.interactionMode)) {
          setDefaultInteractionMode(config.defaults.interactionMode)
        }
        if (config?.defaults?.useWorktree !== undefined) setUseWorktree(config.defaults.useWorktree)
      })
      .catch((err) => console.error('Failed to load workspace config:', err))
      .finally(() => setLoading(false))
  }, [open, workspacePath])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // 1. Update Workspace Metadata (Local)
      await updateWorkspace(workspaceId, {
        defaultAgentId: defaultAgentId || undefined,
        defaultModelId: defaultModelId || undefined,
        defaultInteractionMode: defaultInteractionMode || undefined,
        defaultUseWorktree: useWorktree
      })

      // 2. Update .agent/config.json (Shared)
      const hooks: WorktreeHooksConfig = {}
      if (symlinks.length > 0) hooks.symlinks = symlinks
      if (commands.length > 0) hooks.postSetupCommands = commands
      if (initialPrompt.trim()) hooks.initialPrompt = initialPrompt.trim()

      const config: AgentProjectConfig = {
        ...fullConfig,
        specVersion: fullConfig?.specVersion || '1.1',
        defaults: {
          ...fullConfig?.defaults,
          agentId: defaultAgentId || undefined,
          modelId: defaultModelId || undefined,
          interactionMode: defaultInteractionMode || undefined,
          useWorktree: useWorktree || undefined
        },
        worktreeHooks: Object.keys(hooks).length > 0 ? hooks : undefined
      }

      await window.api.invoke('workspace:set-config', { workspacePath, config })
      onClose()
    } catch (err) {
      console.error('Failed to save workspace settings:', err)
    } finally {
      setSaving(false)
    }
  }, [symlinks, commands, initialPrompt, defaultAgentId, defaultModelId, defaultInteractionMode, useWorktree, fullConfig, workspaceId, workspacePath, updateWorkspace, onClose])

  // Symlink helpers
  const addSymlink = () => setSymlinks([...symlinks, { source: '' }])
  const removeSymlink = (i: number) => setSymlinks(symlinks.filter((_, idx) => idx !== i))
  const updateSymlink = (i: number, updates: Partial<SymlinkEntry>) => {
    setSymlinks(symlinks.map((s, idx) => (idx === i ? { ...s, ...updates } : s)))
  }

  // Command helpers
  const addCommand = () => setCommands([...commands, { command: '' }])
  const removeCommand = (i: number) => setCommands(commands.filter((_, idx) => idx !== i))
  const updateCommand = (i: number, updates: Partial<PostSetupCommand>) => {
    setCommands(commands.map((c, idx) => (idx === i ? { ...c, ...updates } : c)))
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Workspace Settings - ${workspaceName}`}>
      {loading ? (
        <div className="text-text-muted text-sm py-8 text-center">Loading configuration...</div>
      ) : (
        <div className="space-y-6 min-w-[480px]">
          {/* Default Settings */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-2">New Thread Defaults</h3>
            <p className="text-xs text-text-muted mb-3">
              Standard settings for new threads in this workspace.
            </p>
            <div className="space-y-3 bg-surface-2/50 p-3 rounded-md border border-border/50">
              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                  Default Agent
                </label>
                <select
                  value={defaultAgentId}
                  onChange={(e) => {
                    setDefaultAgentId(e.target.value)
                    setDefaultModelId('')
                  }}
                  className="w-full px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">No default agent</option>
                  {installedAgents.map((agent) => (
                    <option key={agent.registryId} value={agent.registryId}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              <ModelPicker
                agentId={defaultAgentId || null}
                projectPath={workspacePath}
                value={defaultModelId}
                onChange={(modelId) => setDefaultModelId(modelId || '')}
                emptyLabel="Default model"
                className="w-full px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
              />
              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                  Default Mode
                </label>
                <select
                  value={defaultInteractionMode}
                  onChange={(e) => setDefaultInteractionMode(e.target.value as InteractionMode)}
                  className="w-full px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="ask">Ask</option>
                  <option value="code">Code</option>
                  <option value="plan">Plan</option>
                  <option value="act">Act</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useWorktree}
                    onChange={(e) => setUseWorktree(e.target.checked)}
                    className="rounded border-border"
                  />
                  Use git worktree by default
                </label>
              </div>
            </div>
          </section>

          {/* Symlinks */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-text-primary">Symlinks</h3>
              <Button variant="ghost" size="sm" onClick={addSymlink}>
                + Add
              </Button>
            </div>
            <p className="text-xs text-text-muted mb-2">
              Create symlinks in the worktree pointing to files/folders in the original repo.
            </p>
            {symlinks.length === 0 ? (
              <div className="text-xs text-text-muted italic py-2">No symlinks configured</div>
            ) : (
              <div className="space-y-2">
                {symlinks.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.source}
                      onChange={(e) => updateSymlink(i, { source: e.target.value })}
                      placeholder="Source path (e.g. .env.local)"
                      className="flex-1 px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <input
                      type="text"
                      value={entry.target || ''}
                      onChange={(e) =>
                        updateSymlink(i, { target: e.target.value || undefined })
                      }
                      placeholder="Target (optional)"
                      className="w-36 px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      onClick={() => removeSymlink(i)}
                      className="p-1 text-text-muted hover:text-error rounded hover:bg-surface-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Post-setup commands */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-text-primary">Post-Setup Commands</h3>
              <Button variant="ghost" size="sm" onClick={addCommand}>
                + Add
              </Button>
            </div>
            <p className="text-xs text-text-muted mb-2">
              Shell commands to run in the worktree after creation.
            </p>
            {commands.length === 0 ? (
              <div className="text-xs text-text-muted italic py-2">No commands configured</div>
            ) : (
              <div className="space-y-2">
                {commands.map((cmd, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex-1 space-y-1">
                      <input
                        type="text"
                        value={cmd.command}
                        onChange={(e) => updateCommand(i, { command: e.target.value })}
                        placeholder="Command (e.g. npm install)"
                        className="w-full px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent font-mono"
                      />
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={cmd.label || ''}
                          onChange={(e) =>
                            updateCommand(i, { label: e.target.value || undefined })
                          }
                          placeholder="Label (optional)"
                          className="flex-1 px-2.5 py-1 text-xs bg-surface-2 border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <label className="flex items-center gap-1 text-xs text-text-secondary whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={cmd.continueOnError || false}
                            onChange={(e) =>
                              updateCommand(i, { continueOnError: e.target.checked || undefined })
                            }
                            className="rounded border-border"
                          />
                          Continue on error
                        </label>
                      </div>
                    </div>
                    <button
                      onClick={() => removeCommand(i)}
                      className="p-1 mt-1 text-text-muted hover:text-error rounded hover:bg-surface-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Initial prompt */}
          <section>
            <h3 className="text-sm font-medium text-text-primary mb-2">Initial Prompt</h3>
            <p className="text-xs text-text-muted mb-2">
              Automatically sent to the agent when a worktree session starts.
            </p>
            <textarea
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="e.g. Read CONTRIBUTING.md and suggest what to work on next."
              rows={3}
              className="w-full px-3 py-2 text-xs bg-surface-2 border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            />
          </section>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
              Save
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
