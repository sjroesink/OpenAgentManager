import { create } from 'zustand'
import type { AcpRegistry, AcpRegistryAgent, InstalledAgent, AgentConnection } from '@shared/types/agent'

interface AgentState {
  // Registry
  registry: AcpRegistry | null
  registryLoading: boolean
  registryError: string | null

  // Installed agents
  installed: InstalledAgent[]

  // Active connections
  connections: AgentConnection[]

  // Actions
  fetchRegistry: () => Promise<void>
  installAgent: (agentId: string) => Promise<InstalledAgent>
  uninstallAgent: (agentId: string) => Promise<void>
  loadInstalled: () => Promise<void>
  launchAgent: (agentId: string, projectPath: string, extraEnv?: Record<string, string>) => Promise<AgentConnection>
  terminateAgent: (connectionId: string) => Promise<void>
  logoutAgent: (connectionId: string) => Promise<void>
  authenticateAgent: (connectionId: string, method: string, credentials?: Record<string, string>) => Promise<void>
  updateConnectionStatus: (connectionId: string, status: AgentConnection['status'], error?: string) => void

  // Helpers
  getRegistryAgent: (agentId: string) => AcpRegistryAgent | undefined
  isInstalled: (agentId: string) => boolean
}

export const useAgentStore = create<AgentState>((set, get) => ({
  registry: null,
  registryLoading: false,
  registryError: null,
  installed: [],
  connections: [],

  fetchRegistry: async () => {
    set({ registryLoading: true, registryError: null })
    try {
      const registry = await window.api.invoke('registry:fetch', undefined)
      set({ registry, registryLoading: false })
    } catch (error) {
      set({ registryError: (error as Error).message, registryLoading: false })
    }
  },

  installAgent: async (agentId: string) => {
    const result = await window.api.invoke('agent:install', { agentId })
    set((state) => ({
      installed: [...state.installed.filter((a) => a.registryId !== agentId), result]
    }))
    return result
  },

  uninstallAgent: async (agentId: string) => {
    await window.api.invoke('agent:uninstall', { agentId })
    set((state) => ({
      installed: state.installed.filter((a) => a.registryId !== agentId)
    }))
  },

  loadInstalled: async () => {
    const installed = await window.api.invoke('agent:list-installed', undefined)
    set({ installed })
  },

  launchAgent: async (agentId: string, projectPath: string, extraEnv?: Record<string, string>) => {
    const connection = await window.api.invoke('agent:launch', { agentId, projectPath, extraEnv })
    set((state) => ({
      connections: [...state.connections, connection]
    }))
    return connection
  },

  terminateAgent: async (connectionId: string) => {
    await window.api.invoke('agent:terminate', { connectionId })
    set((state) => ({
      connections: state.connections.filter((c) => c.connectionId !== connectionId)
    }))
  },

  logoutAgent: async (connectionId: string) => {
    await window.api.invoke('agent:logout', { connectionId })
  },

  authenticateAgent: async (connectionId, method, credentials) => {
    await window.api.invoke('agent:authenticate', { connectionId, method, credentials })
    set((state) => ({
      connections: state.connections.map((c) =>
        c.connectionId === connectionId ? { ...c, status: 'connected' as const } : c
      )
    }))
  },

  updateConnectionStatus: (connectionId, status, error) => {
    set((state) => ({
      connections: state.connections.map((c) =>
        c.connectionId === connectionId ? { ...c, status, error } : c
      )
    }))
  },

  getRegistryAgent: (agentId) => {
    return get().registry?.agents.find((a) => a.id === agentId)
  },

  isInstalled: (agentId) => {
    return get().installed.some((a) => a.registryId === agentId)
  }
}))
