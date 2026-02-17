import React from 'react'
import { useAgentStore } from '../../stores/agent-store'
import { useSessionStore } from '../../stores/session-store'
import { Badge } from '../common/Badge'

export function StatusBar() {
  const connections = useAgentStore((s) => s.connections)
  const sessions = useSessionStore((s) => s.sessions)

  const activeConnections = connections.filter((c) => c.status === 'connected')
  const activeSessions = sessions.filter((s) => s.status === 'prompting')

  return (
    <div className="flex items-center h-6 px-3 bg-surface-1 border-t border-border text-[11px] text-text-muted gap-4 shrink-0">
      {/* Connected agents */}
      {activeConnections.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          <span>
            {activeConnections.length} agent{activeConnections.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Active prompts */}
      {activeSessions.length > 0 && (
        <Badge variant="accent">
          {activeSessions.length} running
        </Badge>
      )}
    </div>
  )
}
