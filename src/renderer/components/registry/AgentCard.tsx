import React, { useState } from 'react'
import type { AcpRegistryAgent } from '@shared/types/agent'
import { useAgentStore } from '../../stores/agent-store'
import { Button } from '../common/Button'
import { Badge } from '../common/Badge'

interface AgentCardProps {
  agent: AcpRegistryAgent
}

export function AgentCard({ agent }: AgentCardProps) {
  const { isInstalled, installAgent, uninstallAgent } = useAgentStore()
  const installed = isInstalled(agent.id)
  const [loading, setLoading] = useState(false)

  const handleToggleInstall = async () => {
    setLoading(true)
    try {
      if (installed) {
        await uninstallAgent(agent.id)
      } else {
        await installAgent(agent.id)
      }
    } catch (error) {
      console.error('Install/uninstall error:', error)
    } finally {
      setLoading(false)
    }
  }

  const distributionType = agent.distribution.npx
    ? 'npx'
    : agent.distribution.uvx
    ? 'uvx'
    : agent.distribution.binary
    ? 'binary'
    : 'unknown'

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-2 hover:border-border-subtle transition-colors">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center text-lg font-bold text-accent shrink-0">
          {agent.name[0]}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-text-primary truncate">{agent.name}</h3>
            <Badge variant="default">{agent.version}</Badge>
          </div>

          <p className="text-xs text-text-secondary mb-2 line-clamp-2">{agent.description}</p>

          <div className="flex items-center gap-2 text-[10px] text-text-muted">
            <span>{agent.authors.join(', ')}</span>
            <span>|</span>
            <span>{agent.license}</span>
            <span>|</span>
            <Badge variant="default">{distributionType}</Badge>
          </div>
        </div>

        {/* Install button */}
        <Button
          variant={installed ? 'danger' : 'primary'}
          size="sm"
          loading={loading}
          onClick={handleToggleInstall}
          className="shrink-0"
        >
          {installed ? 'Remove' : 'Install'}
        </Button>
      </div>
    </div>
  )
}
