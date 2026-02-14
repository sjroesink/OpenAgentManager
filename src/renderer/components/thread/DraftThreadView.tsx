import React, { useState, useRef, useCallback } from 'react'
import { useSessionStore, type DraftThread } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { AgentSelector } from '../sidebar/AgentSelector'
import { Button } from '../common/Button'
import type { InstalledAgent } from '@shared/types/agent'

interface DraftThreadViewProps {
  draft: DraftThread
}

export function DraftThreadView({ draft }: DraftThreadViewProps) {
  const { updateDraftThread, commitDraftThread, discardDraftThread } = useSessionStore()
  const { workspaces, createWorkspace } = useWorkspaceStore()
  const workspace = workspaces.find((w) => w.id === draft.workspaceId)

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = !!draft.agentId && text.trim().length > 0 && !sending

  const handleWorkspaceChange = useCallback(
    async (value: string) => {
      if (value === '__new__') {
        const path = await window.api.invoke('workspace:select-directory', undefined)
        if (!path) return
        try {
          const ws = await createWorkspace(path)
          updateDraftThread({ workspaceId: ws.id, workspacePath: ws.path, useWorktree: false })
        } catch (err) {
          console.error('Failed to create workspace:', err)
        }
      } else {
        const ws = workspaces.find((w) => w.id === value)
        if (ws) {
          updateDraftThread({ workspaceId: ws.id, workspacePath: ws.path, useWorktree: false })
        }
      }
    },
    [workspaces, createWorkspace, updateDraftThread]
  )

  const handleAgentSelect = useCallback(
    (agent: InstalledAgent) => {
      updateDraftThread({ agentId: agent.registryId })
    },
    [updateDraftThread]
  )

  const handleSubmit = useCallback(async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      await commitDraftThread(text.trim())
    } catch (err) {
      setError((err as Error).message || 'Failed to create thread')
      setSending(false)
    }
  }, [canSend, text, commitDraftThread])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }

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

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              First message
            </label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={
                  draft.agentId
                    ? 'Type your message and press Enter to create the thread...'
                    : 'Select an agent first...'
                }
                disabled={!draft.agentId || sending}
                rows={2}
                className="w-full bg-surface-1 border border-border rounded-xl px-4 py-2.5 pr-14 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-colors disabled:opacity-50"
                style={{ minHeight: '60px', maxHeight: '200px' }}
              />
              <Button
                variant="primary"
                size="md"
                disabled={!canSend}
                loading={sending}
                onClick={handleSubmit}
                className="absolute right-2 top-1/2 -translate-y-1/2 shrink-0 rounded-xl h-[40px] w-[40px] !p-0"
              >
                {!sending && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                )}
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
