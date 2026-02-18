import React, { useEffect, useState } from 'react'

import { getApiKeyEnvVarsForAgent } from '@shared/config/agent-env'
import type { AppSettings, McpServerConfig } from '@shared/types/settings'
import { DEFAULT_SETTINGS } from '@shared/types/settings'

import { useRouteStore } from '../../stores/route-store'
import { useAgentStore } from '../../stores/agent-store'
import { Button } from '../common/Button'
import type { PermissionRule } from '@shared/types/session'
import { ModelPicker } from '../common/ModelPicker'

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
      <div className="shrink-0">
        <label className="text-sm text-text-primary">{label}</label>
        {description && <p className="text-[11px] text-text-muted mt-0.5">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-1 justify-end [&>*]:min-w-0 [&>*]:max-w-full">
        {children}
      </div>
    </div>
  )
}

export function SettingsView() {
  const navigate = useRouteStore((s) => s.navigate)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<'general' | 'git' | 'agents' | 'mcp' | 'permissions'>('general')
  const [permissionRules, setPermissionRules] = useState<PermissionRule[]>([])
  const [modelPickerProjectPath, setModelPickerProjectPath] = useState('')
  const [wslInfo, setWslInfo] = useState<{ available: boolean; distributions: string[] }>({
    available: false,
    distributions: []
  })
  const installedAgents = useAgentStore((s) => s.installed)

  useEffect(() => {
    window.api.invoke('settings:get', undefined).then(setSettings)
    window.api.invoke('system:wsl-info', undefined).then(setWslInfo).catch(() => {})
    window.api.invoke('permission:list-rules', {}).then(setPermissionRules).catch(() => {})
    window.api
      .invoke('workspace:list', undefined)
      .then((workspaces) => {
        if (workspaces.length === 0) return
        const mostRecent = [...workspaces].sort((a, b) => {
          return new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
        })[0]
        setModelPickerProjectPath(mostRecent.path)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('home')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.api.invoke('settings:set', settings)
      window.dispatchEvent(new Event('theme-changed'))
    } finally {
      setSaving(false)
      navigate('home')
    }
  }

  const sections = [
    { id: 'general' as const, label: 'General' },
    { id: 'git' as const, label: 'Git & Worktrees' },
    { id: 'agents' as const, label: 'Agents' },
    { id: 'mcp' as const, label: 'MCP Servers' },
    { id: 'permissions' as const, label: 'Permissions' }
  ]

  const removePermissionRule = async (ruleId: string) => {
    try {
      await window.api.invoke('permission:remove-rule', { ruleId })
      setPermissionRules((prev) => prev.filter((r) => r.id !== ruleId))
    } catch (err) {
      console.error('[SettingsView] Failed to remove permission rule:', err)
    }
  }

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

  const updateAgentSettings = (agentId: string, updater: (current: NonNullable<AppSettings['agents'][string]>) => AppSettings['agents'][string]) => {
    const current = settings.agents[agentId] ?? {}
    setSettings({
      ...settings,
      agents: {
        ...settings.agents,
        [agentId]: updater(current)
      }
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center px-4 py-2 border-b border-border shrink-0 gap-2">
        <button
          onClick={() => navigate('home')}
          className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
          title="Close settings (Esc)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <span className="text-sm font-medium text-text-primary">Settings</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex flex-col gap-6 md:flex-row">
            {/* Section nav */}
            <div className="w-full shrink-0 space-y-0.5 md:w-40">
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

            {/* Settings fields */}
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
                          general: {
                            ...settings.general,
                            summarizationAgentId: e.target.value || undefined,
                            summarizationModel: undefined
                          }
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

                  <SettingsField
                    label="Title Generation Model"
                    description={
                      modelPickerProjectPath
                        ? 'Optional model override for title generation.'
                        : 'Add a workspace to load available models for the selected agent.'
                    }
                  >
                    <ModelPicker
                      agentId={settings.general.summarizationAgentId || null}
                      projectPath={modelPickerProjectPath}
                      value={settings.general.summarizationModel}
                      onChange={(modelId) =>
                        setSettings({
                          ...settings,
                          general: {
                            ...settings.general,
                            summarizationModel: modelId || undefined
                          }
                        })
                      }
                      emptyLabel="Agent default model"
                      showLabel={false}
                      className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary"
                    />
                  </SettingsField>
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
                  Agent-specific settings are shown from a static env-var mapping per installed agent.
                  <div className="mt-4 space-y-3">
                    {installedAgents.map((agent) => {
                      const agentId = agent.registryId
                      const agentSettings = settings.agents[agentId] ?? {}
                      const apiKeyEnvVars = getApiKeyEnvVarsForAgent(agentId)

                      return (
                        <div key={agentId} className="border border-border rounded-lg p-3">
                          <div className="text-sm font-medium text-text-primary mb-2">{agent.name} ({agentId})</div>
                          {apiKeyEnvVars.length > 0 ? (
                            apiKeyEnvVars.map((envVarName) => (
                              <SettingsField key={envVarName} label={envVarName}>
                                <input
                                  type="password"
                                  value={agentSettings.apiKeys?.[envVarName] || ''}
                                  onChange={(e) =>
                                    updateAgentSettings(agentId, (current) => ({
                                      ...current,
                                      apiKeys: {
                                        ...(current.apiKeys || {}),
                                        [envVarName]: e.target.value || ''
                                      }
                                    }))
                                  }
                                  placeholder={`Enter ${envVarName}`}
                                  className="bg-surface-2 border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                                />
                              </SettingsField>
                            ))
                          ) : (
                            <p className="text-text-muted text-xs mb-2">
                              No API key env vars mapped for this agent yet.
                            </p>
                          )}
                        {wslInfo.available && (
                          <>
                            <SettingsField label="Run in WSL" description="Run this agent inside Windows Subsystem for Linux">
                              <input
                                type="checkbox"
                                checked={agentSettings.runInWsl || false}
                                onChange={(e) =>
                                  updateAgentSettings(agentId, (current) => ({
                                    ...current,
                                    runInWsl: e.target.checked
                                  }))
                                }
                              />
                            </SettingsField>
                            {agentSettings.runInWsl && wslInfo.distributions.length > 0 && (
                              <SettingsField label="WSL Distribution" description="Leave on default to use your default WSL distro">
                                <select
                                  value={agentSettings.wslDistribution || ''}
                                  onChange={(e) =>
                                    updateAgentSettings(agentId, (current) => ({
                                      ...current,
                                      wslDistribution: e.target.value || undefined
                                    }))
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
                      )
                    })}
                    {installedAgents.length === 0 && (
                      <p className="text-text-muted text-xs">No installed agents yet.</p>
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

              {activeSection === 'permissions' && (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted">
                    When you click &quot;Always&quot; on a permission request, a rule is saved here.
                    Matching future requests are auto-approved or auto-rejected without prompting.
                  </p>
                  {permissionRules.length === 0 ? (
                    <p className="text-text-muted text-xs">No permission rules saved yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {permissionRules.map((rule) => (
                        <div key={rule.id} className="border border-border rounded-lg p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                                  rule.ruleKind === 'allow_always'
                                    ? 'bg-success/10 text-success'
                                    : 'bg-error/10 text-error'
                                }`}
                              >
                                {rule.ruleKind === 'allow_always' ? 'Allow' : 'Reject'}
                              </span>
                              <span className="text-sm font-medium text-text-primary font-mono">{rule.matchKey}</span>
                            </div>
                            <div className="text-xs text-text-muted mt-1">
                              Scope: <span className="font-medium text-text-secondary">{rule.scope}</span>
                              {rule.scope === 'thread' && rule.threadId && (
                                <span> · Thread {rule.threadId.slice(0, 8)}</span>
                              )}
                              <span> · Created {new Date(rule.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => removePermissionRule(rule.id)}
                            className="text-text-muted hover:text-error text-sm px-2 py-1 rounded hover:bg-surface-2 transition-colors shrink-0"
                            title="Remove rule"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
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
        </div>
      </div>
    </div>
  )
}
