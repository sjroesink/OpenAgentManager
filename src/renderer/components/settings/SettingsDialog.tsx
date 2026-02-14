import React, { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { Dialog } from '../common/Dialog'
import { Button } from '../common/Button'
import type { AppSettings } from '@shared/types/settings'
import { DEFAULT_SETTINGS } from '@shared/types/settings'

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen } = useUiStore()
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<'general' | 'git' | 'agents'>('general')
  const [wslInfo, setWslInfo] = useState<{ available: boolean; distributions: string[] }>({
    available: false,
    distributions: []
  })

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
    { id: 'agents' as const, label: 'Agents' }
  ]

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
