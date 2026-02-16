import React, { useState, useCallback } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useAgentStore } from '../../stores/agent-store'
import { useProjectStore } from '../../stores/project-store'
import { AgentSelector } from './AgentSelector'
import { Button } from '../common/Button'
import { Badge } from '../common/Badge'
import { AgentIcon } from '../common/AgentIcon'
import type { InstalledAgent } from '@shared/types/agent'

const statusDotColors: Record<string, string> = {
  active: 'bg-success',
  prompting: 'bg-accent animate-pulse',
  idle: 'bg-text-muted/60',
  error: 'bg-error',
  creating: 'bg-warning animate-pulse',
  initializing: 'bg-warning animate-pulse',
  cancelled: 'bg-text-muted/60'
}

function SessionIcon({
  agentId,
  icon,
  name,
  status = 'idle'
}: {
  agentId: string
  icon?: string
  name: string
  status?: string
}) {
  const dotColor = statusDotColors[status] || statusDotColors.idle
  return (
    <div className="relative w-4 h-4 shrink-0">
      <AgentIcon
        agentId={agentId}
        icon={icon}
        name={name}
        size="sm"
      />
      <span className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-surface-0 ${dotColor}`} />
    </div>
  )
}

export function ThreadList() {
  const { sessions, activeSessionId, setActiveSession, createSession } = useSessionStore()
  const { connections, launchAgent, installed } = useAgentStore()
  const project = useProjectStore((s) => s.project)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [useWorktree, setUseWorktree] = useState(false)
  const [creating, setCreating] = useState(false)

  const handleNewThread = useCallback(async () => {
    if (!selectedAgentId || !project) return
    setCreating(true)

    try {
      // Find existing connection or launch a new one
      let connection = connections.find(
        (c) => c.agentId === selectedAgentId && c.status === 'connected'
      )

      if (!connection) {
        connection = await launchAgent(selectedAgentId, project.path)
      }

      // Create session
      await createSession(connection.connectionId, project.path, useWorktree, '')
    } catch (error) {
      console.error('Failed to create thread:', error)
    } finally {
      setCreating(false)
    }
  }, [selectedAgentId, project, connections, launchAgent, createSession, useWorktree])

  const handleAgentSelect = (agent: InstalledAgent) => {
    setSelectedAgentId(agent.registryId)
  }

  return (
    <div className="flex flex-col h-full">
      {/* New thread controls */}
      <div className="p-3 border-b border-border space-y-2">
        <AgentSelector selectedAgentId={selectedAgentId} onSelect={handleAgentSelect} />

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={useWorktree}
              onChange={(e) => setUseWorktree(e.target.checked)}
              className="rounded border-border"
            />
            Git worktree
          </label>
        </div>

        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={!selectedAgentId || !project || creating}
          loading={creating}
          onClick={handleNewThread}
        >
          New Thread
        </Button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-text-muted">
            No threads yet. Select an agent and create one.
          </div>
        ) : (
          <div className="py-1">
            {sessions.map((session) => {
              const sessionIcon = installed.find((a) => a.registryId === session.agentId)?.icon
              return (
                <button
                  key={session.sessionId}
                  onClick={() => setActiveSession(session.sessionId)}
                  className={`
                    w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors
                    ${
                      session.sessionId === activeSessionId
                        ? 'bg-accent/10 border-r-2 border-accent'
                        : 'hover:bg-surface-2'
                    }
                  `}
                >
                  <SessionIcon
                    agentId={session.agentId}
                    icon={sessionIcon}
                    name={session.agentName}
                    status={session.status}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{session.title}</div>
                    <div className="text-xs text-text-muted truncate">{session.agentName}</div>
                    {session.worktreeBranch && (
                      <Badge variant="default" className="mt-1">
                        {session.worktreeBranch}
                      </Badge>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
