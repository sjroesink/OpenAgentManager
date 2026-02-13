import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import { useAgentStore } from '../../stores/agent-store'
import { useSessionStore } from '../../stores/session-store'
import { Badge } from '../common/Badge'

export function StatusBar() {
  const project = useProjectStore((s) => s.project)
  const gitStatus = useProjectStore((s) => s.gitStatus)
  const connections = useAgentStore((s) => s.connections)
  const sessions = useSessionStore((s) => s.sessions)

  const activeConnections = connections.filter((c) => c.status === 'connected')
  const activeSessions = sessions.filter((s) => s.status === 'prompting')

  return (
    <div className="flex items-center h-6 px-3 bg-surface-1 border-t border-border text-[11px] text-text-muted gap-4 shrink-0">
      {/* Git branch */}
      {gitStatus && (
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{gitStatus.branch}</span>
          {!gitStatus.isClean && (
            <span className="text-warning">*</span>
          )}
        </div>
      )}

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

      <div className="flex-1" />

      {/* Project path */}
      {project && (
        <span className="truncate max-w-[300px]">{project.path}</span>
      )}
    </div>
  )
}
