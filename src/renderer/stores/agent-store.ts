import { create } from 'zustand'
import type {
  AcpRegistry,
  AcpRegistryAgent,
  InstalledAgent,
  AgentConnection,
  AgentModelCatalog,
  AgentModeCatalog
} from '@shared/types/agent'

interface AgentState {
  // Registry
  registry: AcpRegistry | null
  registryLoading: boolean
  registryError: string | null

  // Installed agents
  installed: InstalledAgent[]

  // Active connections
  connections: AgentConnection[]
  modelsByAgent: Record<string, AgentModelCatalog>
  modelsLoadingByAgent: Record<string, boolean>
  modesByAgent: Record<string, AgentModeCatalog>
  modesLoadingByAgent: Record<string, boolean>

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
  loadAgentModels: (agentId: string, projectPath: string) => Promise<AgentModelCatalog>
  loadAgentModes: (agentId: string, projectPath: string) => Promise<AgentModeCatalog>

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
  modelsByAgent: {},
  modelsLoadingByAgent: {},
  modesByAgent: {},
  modesLoadingByAgent: {},

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

  loadAgentModels: async (agentId, projectPath) => {
    const cached = get().modelsByAgent[agentId]
    if (cached && cached.availableModels.length > 0) return cached

    set((state) => ({
      modelsLoadingByAgent: { ...state.modelsLoadingByAgent, [agentId]: true }
    }))
    try {
      const catalog = await window.api.invoke('agent:get-models', { agentId, projectPath })
      set((state) => ({
        modelsByAgent: { ...state.modelsByAgent, [agentId]: catalog },
        modelsLoadingByAgent: { ...state.modelsLoadingByAgent, [agentId]: false }
      }))
      return catalog
    } catch (error) {
      set((state) => ({
        modelsLoadingByAgent: { ...state.modelsLoadingByAgent, [agentId]: false }
      }))
      throw error
    }
  },

  loadAgentModes: async (agentId, projectPath) => {
    const cached = get().modesByAgent[agentId]
    if (cached && cached.availableModes.length > 0) return cached

    set((state) => ({
      modesLoadingByAgent: { ...state.modesLoadingByAgent, [agentId]: true }
    }))
    try {
      const catalog = await window.api.invoke('agent:get-modes', { agentId, projectPath })
      set((state) => ({
        modesByAgent: { ...state.modesByAgent, [agentId]: catalog },
        modesLoadingByAgent: { ...state.modesLoadingByAgent, [agentId]: false }
      }))
      return catalog
    } catch (error) {
      set((state) => ({
        modesLoadingByAgent: { ...state.modesLoadingByAgent, [agentId]: false }
      }))
      throw error
    }
  },

  getRegistryAgent: (agentId) => {
    return get().registry?.agents.find((a) => a.id === agentId)
  },

  isInstalled: (agentId) => {
    return get().installed.some((a) => a.registryId === agentId)
  }
}))
