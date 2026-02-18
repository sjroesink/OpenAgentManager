import React, { useState, useEffect } from 'react'
import type { InstalledAgent } from '@shared/types/agent'
import { getApiKeyEnvVarsForAgent, getApiKeyInfoForAgent } from '@shared/config/agent-env'
import type { AppSettings } from '@shared/types/settings'
import { AgentIcon } from '../common/AgentIcon'

interface ApiKeyConfigStepProps {
  agents: InstalledAgent[]
}

export function ApiKeyConfigStep({ agents }: ApiKeyConfigStepProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    window.api.invoke('settings:get', undefined).then(setSettings)
  }, [])

  if (!settings) return null

  const updateApiKey = (agentId: string, envVar: string, value: string) => {
    setSettings((prev) => {
      if (!prev) return prev
      const agentSettings = prev.agents[agentId] ?? {}
      return {
        ...prev,
        agents: {
          ...prev.agents,
          [agentId]: {
            ...agentSettings,
            apiKeys: {
              ...(agentSettings.apiKeys ?? {}),
              [envVar]: value
            }
          }
        }
      }
    })
  }

  const handleSaveAgent = async (agentId: string) => {
    if (!settings) return
    const agentSettings = settings.agents[agentId]
    if (agentSettings) {
      await window.api.invoke('settings:set-agent', { agentId, settings: { ...agentSettings } })
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-text-primary mb-2">Configure API Keys</h2>
      <p className="text-sm text-text-secondary mb-6">
        Enter API keys for your installed agents. You can always change these later in Settings.
      </p>

      <div className="space-y-6">
        {agents.map((agent) => {
          const agentId = agent.registryId
          const envVars = getApiKeyEnvVarsForAgent(agentId)
          const keyInfos = getApiKeyInfoForAgent(agentId)
          const agentSettings = settings.agents[agentId] ?? {}

          return (
            <div key={agentId} className="border border-border rounded-lg p-5 bg-surface-2">
              <div className="flex items-center gap-3 mb-4">
                <AgentIcon
                  agentId={agentId}
                  icon={agent.icon}
                  name={agent.name}
                  size="lg"
                />
                <h3 className="text-sm font-semibold text-text-primary">{agent.name}</h3>
              </div>

              <div className="space-y-4">
                {envVars.map((envVar) => {
                  const info = keyInfos.find((k) => k.envVar === envVar)
                  const currentValue = agentSettings.apiKeys?.[envVar] ?? ''

                  return (
                    <div key={envVar}>
                      <label className="block text-sm text-text-primary mb-1 font-medium">
                        {envVar}
                      </label>
                      {info?.description && (
                        <p className="text-xs text-text-secondary mb-2">{info.description}</p>
                      )}
                      <input
                        type="password"
                        value={currentValue}
                        onChange={(e) => updateApiKey(agentId, envVar, e.target.value)}
                        onBlur={() => handleSaveAgent(agentId)}
                        placeholder={`Enter ${envVar}`}
                        className="w-full bg-surface-1 border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50"
                      />
                      {info?.providerUrl && (
                        <a
                          href={info.providerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover mt-1.5 underline underline-offset-2"
                        >
                          Get a key from {info.providerLabel}
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {agents.length === 0 && (
        <div className="text-center py-8 text-sm text-text-muted">
          No installed agents require API key configuration.
        </div>
      )}
    </div>
  )
}
