import Store from 'electron-store'
import { v4 as uuid } from 'uuid'
import type { AppSettings, AgentSettings, McpServerConfig, AgentSkill } from '@shared/types/settings'
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
      mcp: store.get('mcp', DEFAULT_SETTINGS.mcp),
      skills: store.get('skills', DEFAULT_SETTINGS.skills)
    }
  }

  set(partial: Partial<AppSettings>): void {
    if (partial.general) store.set('general', { ...this.get().general, ...partial.general })
    if (partial.git) store.set('git', { ...this.get().git, ...partial.git })
    if (partial.agents) store.set('agents', { ...this.get().agents, ...partial.agents })
    if (partial.mcp) store.set('mcp', { ...this.get().mcp, ...partial.mcp })
    if (partial.skills) store.set('skills', partial.skills)
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

  getMcpServers(): McpServerConfig[] {
    return this.get().mcp.servers
  }

  addMcpServer(server: McpServerConfig): void {
    const current = this.get().mcp
    store.set('mcp', { ...current, servers: [...current.servers, server] })
  }

  removeMcpServer(serverId: string): void {
    const current = this.get().mcp
    store.set('mcp', { ...current, servers: current.servers.filter((s) => s.id !== serverId) })
  }

  updateMcpServer(serverId: string, updates: Partial<McpServerConfig>): void {
    const current = this.get().mcp
    const servers = current.servers.map((s) => (s.id === serverId ? { ...s, ...updates } : s))
    store.set('mcp', { ...current, servers })
  }

  // ============================
  // Skills CRUD
  // ============================

  getSkills(): AgentSkill[] {
    return store.get('skills', [])
  }

  createSkill(data: { name: string; description: string; prompt: string; agentId?: string }): AgentSkill {
    const skill: AgentSkill = {
      id: uuid(),
      name: data.name,
      description: data.description,
      prompt: data.prompt,
      agentId: data.agentId,
      createdAt: new Date().toISOString()
    }
    const current = this.getSkills()
    store.set('skills', [...current, skill])
    return skill
  }

  updateSkill(id: string, updates: Partial<Pick<AgentSkill, 'name' | 'description' | 'prompt' | 'agentId'>>): AgentSkill {
    const skills = this.getSkills()
    const idx = skills.findIndex((s) => s.id === id)
    if (idx === -1) throw new Error(`Skill not found: ${id}`)
    const updated = { ...skills[idx], ...updates }
    skills[idx] = updated
    store.set('skills', skills)
    return updated
  }

  deleteSkill(id: string): void {
    const current = this.getSkills()
    store.set('skills', current.filter((s) => s.id !== id))
  }
}

export const settingsService = new SettingsService()
