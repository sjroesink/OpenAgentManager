import React, { useState, useEffect } from 'react'
import type { AcpRegistryAgent } from '@shared/types/agent'
import { useAgentStore } from '../../stores/agent-store'
import { Button } from '../common/Button'
import { Badge } from '../common/Badge'

const AGENT_ICON_BASE = 'https://cdn.agentclientprotocol.com/registry/v1/latest'

function AgentIcon({ agentId, name, size = 'lg' }: { agentId: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const iconUrl = `${AGENT_ICON_BASE}/${agentId}.svg`

  useEffect(() => {
    fetch(iconUrl)
      .then((res) => res.text())
      .then((svg) => setSvgContent(svg))
      .catch(() => setSvgContent(null))
  }, [iconUrl])

  const sizeClass = size === 'lg' ? 'w-10 h-10' : size === 'md' ? 'w-6 h-6' : 'w-4 h-4'

  if (svgContent) {
    return (
      <span
        className={`${sizeClass} rounded-lg shrink-0`}
        dangerouslySetInnerHTML={{ __html: svgContent.replace(/<svg/, `<svg class="${sizeClass}"`) }}
      />
    )
  }

  return (
    <span className={`${sizeClass} rounded-lg bg-surface-3 flex items-center justify-center text-lg font-bold text-accent shrink-0`}>
      {name[0]}
    </span>
  )
}

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
        <AgentIcon
          agentId={agent.id}
          name={agent.name}
          size="lg"
        />

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
