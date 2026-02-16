import React, { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useAgentStore } from '../../stores/agent-store'
import { Dialog } from '../common/Dialog'
import { Button } from '../common/Button'
import type { AppSettings, McpServerConfig } from '@shared/types/settings'
import { DEFAULT_SETTINGS } from '@shared/types/settings'

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen } = useUiStore()
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<'general' | 'git' | 'agents' | 'mcp'>('general')
  const [wslInfo, setWslInfo] = useState<{ available: boolean; distributions: string[] }>({
    available: false,
    distributions: []
  })
  const installedAgents = useAgentStore((s) => s.installed)

  useEffect(() => {
    if (settingsOpen) {
      window.api.invoke('settings:get', undefined).then(setSettings)
      window.api.invoke('system:wsl-info', undefined).then(setWslInfo).catch(() => {})
    }
  }, [settingsOpen])

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.api.invoke('settings:set', settings)
    } finally {
      setSaving(false)
      setSettingsOpen(false)
    }
  }

  const sections = [
    { id: 'general' as const, label: 'General' },
    { id: 'git' as const, label: 'Git & Worktrees' },
    { id: 'agents' as const, label: 'Agents' },
    { id: 'mcp' as const, label: 'MCP Servers' }
  ]

  const addMcpServer = () => {
    const id = crypto.randomUUID()
    const newServer: McpServerConfig = {
      id,
      name: '',
      transport: 'stdio',
      enabled: true
    }
    setSettings({
      ...settings,
      mcp: { ...settings.mcp, servers: [...settings.mcp.servers, newServer] }
    })
  }

  const removeMcpServer = (serverId: string) => {
    setSettings({
      ...settings,
      mcp: { ...settings.mcp, servers: settings.mcp.servers.filter((s) => s.id !== serverId) }
    })
  }

  const updateMcpServer = (serverId: string, updates: Partial<McpServerConfig>) => {
    setSettings({
      ...settings,
      mcp: {
        ...settings.mcp,
        servers: settings.mcp.servers.map((s) => (s.id === serverId ? { ...s, ...updates } : s))
      }
    })
  }

  const envToString = (env?: Record<string, string>) =>
    Object.entries(env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

  const stringToEnv = (str: string): Record<string, string> => {
    const env: Record<string, string> = {}
    str.split('\n').forEach((line) => {
      const eq = line.indexOf('=')
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    })
    return env
  }

  return (
    <Dialog
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title="Settings"
      className="w-[600px]"
    >
      <div className="flex gap-4">
        {/* Sidebar */}
        <div className="w-36 shrink-0 space-y-0.5">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`
                w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors
                ${activeSection === section.id ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'}
              `}
            >
              {section.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 min-w-0">
          {activeSection === 'general' && (
            <>
              <SettingsField label="Theme">
                <select
                  value={settings.general.theme}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      general: { ...settings.general, theme: e.target.value as 'dark' | 'light' | 'system' }
                    })
                  }
                  className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </SettingsField>

              <SettingsField label="Font Size">
                <input
                  type="number"
                  value={settings.general.fontSize}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      general: { ...settings.general, fontSize: parseInt(e.target.value) || 14 }
                    })
                  }
                  className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary w-20"
                  min={10}
                  max={24}
                />
              </SettingsField>

              <SettingsField label="Show Tool Call Details">
                <input
                  type="checkbox"
                  checked={settings.general.showToolCallDetails}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      general: { ...settings.general, showToolCallDetails: e.target.checked }
                    })
                  }
                />
              </SettingsField>

              <SettingsField label="Title Generation Agent" description="Agent used to auto-generate thread titles from conversation content">
                <select
                  value={settings.general.summarizationAgentId || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      general: { ...settings.general, summarizationAgentId: e.target.value || undefined }
                    })
                  }
                  className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary"
                >
                  <option value="">None (manual titles only)</option>
                  {installedAgents.map((agent) => (
                    <option key={agent.registryId} value={agent.registryId}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </SettingsField>
              {settings.general.summarizationAgentId && (
                <SettingsField label="Title Generation Model" description="Model to use for title generation">
                  <input
                    type="text"
                    value={settings.general.summarizationModel || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        general: { ...settings.general, summarizationModel: e.target.value || undefined }
                      })
                    }
                    placeholder="Leave empty for default"
                    className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                  />
                </SettingsField>
              )}
            </>
          )}

          {activeSection === 'git' && (
            <>
              <SettingsField label="Enable Worktrees">
                <input
                  type="checkbox"
                  checked={settings.git.enableWorktrees}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      git: { ...settings.git, enableWorktrees: e.target.checked }
                    })
                  }
                />
              </SettingsField>

              <SettingsField label="Custom Worktree Directory" description="Leave empty for default (sibling directory)">
                <input
                  type="text"
                  value={settings.git.worktreeBaseDir || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      git: { ...settings.git, worktreeBaseDir: e.target.value || undefined }
                    })
                  }
                  placeholder="Auto-detect"
                  className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                />
              </SettingsField>

              <SettingsField label="Commit Prefix">
                <input
                  type="text"
                  value={settings.git.commitPrefix}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      git: { ...settings.git, commitPrefix: e.target.value }
                    })
                  }
                  className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary w-40"
                />
              </SettingsField>

              <SettingsField label="Cleanup Worktrees on Session Close">
                <input
                  type="checkbox"
                  checked={settings.git.cleanupWorktreesOnClose}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      git: { ...settings.git, cleanupWorktreesOnClose: e.target.checked }
                    })
                  }
                />
              </SettingsField>
            </>
          )}

          {activeSection === 'agents' && (
            <div className="text-sm text-text-muted">
              Agent-specific settings (API keys, custom arguments) can be configured per agent after installation.
              <div className="mt-4 space-y-3">
                {Object.entries(settings.agents).map(([agentId, agentSettings]) => (
                  <div key={agentId} className="border border-border rounded-lg p-3">
                    <div className="text-sm font-medium text-text-primary mb-2">{agentId}</div>
                    <SettingsField label="API Key">
                      <input
                        type="password"
                        value={agentSettings.apiKey || ''}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            agents: {
                              ...settings.agents,
                              [agentId]: { ...agentSettings, apiKey: e.target.value || undefined }
                            }
                          })
                        }
                        placeholder="Enter API key"
                        className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                      />
                    </SettingsField>
                    <SettingsField label="Model" description="Model to use (e.g., claude-sonnet-4-20250514)">
                      <input
                        type="text"
                        value={agentSettings.model || ''}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            agents: {
                              ...settings.agents,
                              [agentId]: { ...agentSettings, model: e.target.value || undefined }
                            }
                          })
                        }
                        placeholder="Leave empty for default"
                        className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                      />
                    </SettingsField>
                    {wslInfo.available && (
                      <>
                        <SettingsField label="Run in WSL" description="Run this agent inside Windows Subsystem for Linux">
                          <input
                            type="checkbox"
                            checked={agentSettings.runInWsl || false}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                agents: {
                                  ...settings.agents,
                                  [agentId]: { ...agentSettings, runInWsl: e.target.checked }
                                }
                              })
                            }
                          />
                        </SettingsField>
                        {agentSettings.runInWsl && wslInfo.distributions.length > 0 && (
                          <SettingsField label="WSL Distribution" description="Leave on default to use your default WSL distro">
                            <select
                              value={agentSettings.wslDistribution || ''}
                              onChange={(e) =>
                                setSettings({
                                  ...settings,
                                  agents: {
                                    ...settings.agents,
                                    [agentId]: {
                                      ...agentSettings,
                                      wslDistribution: e.target.value || undefined
                                    }
                                  }
                                })
                              }
                              className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary"
                            >
                              <option value="">Default</option>
                              {wslInfo.distributions.map((distro) => (
                                <option key={distro} value={distro}>
                                  {distro}
                                </option>
                              ))}
                            </select>
                          </SettingsField>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {Object.keys(settings.agents).length === 0 && (
                  <p className="text-text-muted text-xs">No agent-specific settings configured yet.</p>
                )}
              </div>
            </div>
          )}

          {activeSection === 'mcp' && (
            <div className="space-y-3">
              <p className="text-sm text-text-muted">
                Configure external MCP servers that agents can connect to for additional tools
                (e.g., GitHub, Slack, database servers). Enabled servers are passed to agents when
                creating new sessions.
              </p>
              <Button variant="secondary" onClick={addMcpServer}>
                + Add Server
              </Button>
              {settings.mcp.servers.map((server) => (
                <div key={server.id} className="border border-border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      value={server.name}
                      onChange={(e) => updateMcpServer(server.id, { name: e.target.value })}
                      placeholder="Server name"
                      className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary font-medium flex-1 mr-2"
                    />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          onChange={(e) => updateMcpServer(server.id, { enabled: e.target.checked })}
                        />
                        Enabled
                      </label>
                      <button
                        onClick={() => removeMcpServer(server.id)}
                        className="text-text-muted hover:text-error text-sm px-1"
                        title="Remove server"
                      >
                        x
                      </button>
                    </div>
                  </div>

                  <SettingsField label="Transport">
                    <select
                      value={server.transport}
                      onChange={(e) =>
                        updateMcpServer(server.id, {
                          transport: e.target.value as 'stdio' | 'http' | 'sse'
                        })
                      }
                      className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary"
                    >
                      <option value="stdio">stdio</option>
                      <option value="http">HTTP</option>
                      <option value="sse">SSE</option>
                    </select>
                  </SettingsField>

                  {server.transport === 'stdio' ? (
                    <>
                      <SettingsField label="Command">
                        <input
                          type="text"
                          value={server.command || ''}
                          onChange={(e) =>
                            updateMcpServer(server.id, { command: e.target.value || undefined })
                          }
                          placeholder="e.g., npx, node, python"
                          className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                        />
                      </SettingsField>
                      <SettingsField label="Arguments" description="Space-separated arguments">
                        <input
                          type="text"
                          value={(server.args || []).join(' ')}
                          onChange={(e) =>
                            updateMcpServer(server.id, {
                              args: e.target.value.split(/\s+/).filter(Boolean)
                            })
                          }
                          placeholder="e.g., -y @modelcontextprotocol/server-github"
                          className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                        />
                      </SettingsField>
                    </>
                  ) : (
                    <SettingsField label="URL">
                      <input
                        type="text"
                        value={server.url || ''}
                        onChange={(e) =>
                          updateMcpServer(server.id, { url: e.target.value || undefined })
                        }
                        placeholder="e.g., http://localhost:3000/mcp"
                        className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                      />
                    </SettingsField>
                  )}

                  <div>
                    <label className="text-sm text-text-primary">Environment Variables</label>
                    <p className="text-[11px] text-text-muted mt-0.5 mb-1">
                      One per line: KEY=VALUE
                    </p>
                    <textarea
                      value={envToString(server.env)}
                      onChange={(e) => updateMcpServer(server.id, { env: stringToEnv(e.target.value) })}
                      placeholder={'GITHUB_TOKEN=ghp_...\nANOTHER_VAR=value'}
                      rows={2}
                      className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary w-full font-mono resize-y"
                    />
                  </div>
                </div>
              ))}
              {settings.mcp.servers.length === 0 && (
                <p className="text-text-muted text-xs">No MCP servers configured yet.</p>
              )}
            </div>
          )}

          {/* Save button */}
          <div className="flex justify-end pt-4 border-t border-border">
            <Button variant="primary" onClick={handleSave} loading={saving}>
              Save Settings
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function SettingsField({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label className="text-sm text-text-primary">{label}</label>
        {description && <p className="text-[11px] text-text-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}
