import React, { useState, useEffect } from 'react'
import { useAgentStore } from '../../stores/agent-store'
import { getCliCommandsForAgent } from '@shared/config/agent-env'
import { AgentIcon } from '../common/AgentIcon'
import { Badge } from '../common/Badge'
import { Button } from '../common/Button'
import { Spinner } from '../common/Spinner'

export function AgentInstallStep() {
  const {
    registry,
    registryLoading,
    registryError,
    fetchRegistry,
    installAgent,
    uninstallAgent,
    isInstalled
  } = useAgentStore()

  const [installingId, setInstallingId] = useState<string | null>(null)
  const [cliDetection, setCliDetection] = useState<Record<string, boolean>>({})

  // Detect CLI agents on PATH
  useEffect(() => {
    if (!registry?.agents.length) return

    const allCliCommands: string[] = []
    const commandToAgent: Record<string, string> = {}

    for (const agent of registry.agents) {
      const cmds = getCliCommandsForAgent(agent.id)
      for (const cmd of cmds) {
        allCliCommands.push(cmd)
        commandToAgent[cmd] = agent.id
      }
    }

    if (allCliCommands.length === 0) return

    window.api
      .invoke('agent:detect-cli', { commands: allCliCommands })
      .then((results) => {
        const agentResults: Record<string, boolean> = {}
        for (const [cmd, found] of Object.entries(results)) {
          if (found && commandToAgent[cmd]) {
            agentResults[commandToAgent[cmd]] = true
          }
        }
        setCliDetection(agentResults)
      })
      .catch(() => {
        // CLI detection is best-effort
      })
  }, [registry])

  const handleInstall = async (agentId: string) => {
    setInstallingId(agentId)
    try {
      await installAgent(agentId)
    } catch (error) {
      console.error('Install error:', error)
    } finally {
      setInstallingId(null)
    }
  }

  const handleUninstall = async (agentId: string) => {
    setInstallingId(agentId)
    try {
      await uninstallAgent(agentId)
    } catch (error) {
      console.error('Uninstall error:', error)
    } finally {
      setInstallingId(null)
    }
  }

  const agents = registry?.agents ?? []

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-text-primary mb-2">Install Agents</h2>
      <p className="text-sm text-text-secondary mb-6">
        Select the AI coding agents you want to use. Agents marked &quot;Found on PATH&quot; are
        already installed on your system.
      </p>

      {registryLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
          <span className="ml-3 text-sm text-text-secondary">Loading agent registry...</span>
        </div>
      )}

      {registryError && (
        <div className="text-center py-8">
          <p className="text-sm text-error mb-4">Failed to load the agent registry: {registryError}</p>
          <Button variant="secondary" onClick={() => fetchRegistry()}>
            Retry
          </Button>
        </div>
      )}

      {!registryLoading && !registryError && (
        <div className="space-y-3">
          {agents.length === 0 ? (
            <div className="text-sm text-text-muted text-center py-4">No agents available</div>
          ) : (
            agents.map((agent) => {
              const agentInstalled = isInstalled(agent.id)
              const foundOnPath = cliDetection[agent.id] ?? false
              const isLoading = installingId === agent.id

              const distributionType = agent.distribution.npx
                ? 'npx'
                : agent.distribution.uvx
                  ? 'uvx'
                  : agent.distribution.binary
                    ? 'binary'
                    : 'unknown'

              return (
                <div
                  key={agent.id}
                  className="border border-border rounded-lg p-4 bg-surface-2 hover:border-border-subtle transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <AgentIcon
                      agentId={agent.id}
                      icon={agent.icon}
                      name={agent.name}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-sm font-semibold text-text-primary truncate">
                          {agent.name}
                        </h3>
                        <Badge variant="default">{agent.version}</Badge>
                        <Badge variant="default">{distributionType}</Badge>
                        {foundOnPath && <Badge variant="success">Found on PATH</Badge>}
                        {agentInstalled && <Badge variant="accent">Installed</Badge>}
                      </div>
                      <p className="text-xs text-text-secondary mb-2 line-clamp-2">
                        {agent.description}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-text-muted">
                        <span>{agent.authors.join(', ')}</span>
                        <span>|</span>
                        <span>{agent.license}</span>
                      </div>
                    </div>
                    <Button
                      variant={agentInstalled ? 'danger' : 'primary'}
                      size="sm"
                      loading={isLoading}
                      onClick={() =>
                        agentInstalled ? handleUninstall(agent.id) : handleInstall(agent.id)
                      }
                      className="shrink-0"
                    >
                      {agentInstalled ? 'Remove' : 'Install'}
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
