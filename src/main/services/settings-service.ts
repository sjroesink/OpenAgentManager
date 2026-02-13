import Store from 'electron-store'
import type { AppSettings, AgentSettings } from '@shared/types/settings'
import { DEFAULT_SETTINGS } from '@shared/types/settings'

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS
})

export class SettingsService {
  get(): AppSettings {
    return {
      general: store.get('general', DEFAULT_SETTINGS.general),
      git: store.get('git', DEFAULT_SETTINGS.git),
      agents: store.get('agents', DEFAULT_SETTINGS.agents),
      mcp: store.get('mcp', DEFAULT_SETTINGS.mcp)
    }
  }

  set(partial: Partial<AppSettings>): void {
    if (partial.general) store.set('general', { ...this.get().general, ...partial.general })
    if (partial.git) store.set('git', { ...this.get().git, ...partial.git })
    if (partial.agents) store.set('agents', { ...this.get().agents, ...partial.agents })
    if (partial.mcp) store.set('mcp', { ...this.get().mcp, ...partial.mcp })
  }

  getAgentSettings(agentId: string): AgentSettings | undefined {
    const all = store.get('agents', {})
    return all[agentId]
  }

  setAgentSettings(agentId: string, settings: Partial<AgentSettings>): void {
    const all = store.get('agents', {})
    all[agentId] = { ...all[agentId], ...settings }
    store.set('agents', all)
  }
}

export const settingsService = new SettingsService()
