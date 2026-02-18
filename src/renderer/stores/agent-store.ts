import { create } from 'zustand'
import type {
  AcpRegistry,
  AcpRegistryAgent,
  InstalledAgent,
  AgentConnection,
  AgentAuthCheckResult,
  AgentModelCatalog,
  AgentModeCatalog
} from '@shared/types/agent'

function sanitizeAgentCheckErrorMessage(message: string): string {
  const withoutInvokePrefix = message
    .replace(/^Error invoking remote method 'agent:check-auth':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  const lines = withoutInvokePrefix
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const bracketPrefixedLines = lines
    .map((line) => {
      const match = line.match(/^\[[^\]]+\]\s*(.+)$/)
      return match?.[1]?.trim() || null
    })
    .filter((line): line is string => Boolean(line))

  if (bracketPrefixedLines.length > 0) {
    return bracketPrefixedLines.join('\n')
  }

  return withoutInvokePrefix
}

interface AgentState {
  // Registry
  registry: AcpRegistry | null
  registryLoading: boolean
  registryError: string | null

  // Installed agents
  installed: InstalledAgent[]
  authChecks: Record<string, AgentAuthCheckResult>
  authCheckErrors: Record<string, string>

  // Active connections
  connections: AgentConnection[]
  modelsByAgent: Record<string, AgentModelCatalog>
  modelsLoadingByAgent: Record<string, boolean>
  modelErrorsByAgent: Record<string, string>
  modesByAgent: Record<string, AgentModeCatalog>
  modesLoadingByAgent: Record<string, boolean>
  modeErrorsByAgent: Record<string, string>

  // Actions
  fetchRegistry: () => Promise<void>
  installAgent: (agentId: string) => Promise<InstalledAgent>
  uninstallAgent: (agentId: string) => Promise<void>
  loadInstalled: () => Promise<void>
  launchAgent: (agentId: string, projectPath: string, extraEnv?: Record<string, string>) => Promise<AgentConnection>
  checkAgentAuth: (agentId: string, projectPath?: string) => Promise<AgentAuthCheckResult>
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
  authChecks: {},
  authCheckErrors: {},
  connections: [],
  modelsByAgent: {},
  modelsLoadingByAgent: {},
  modelErrorsByAgent: {},
  modesByAgent: {},
  modesLoadingByAgent: {},
  modeErrorsByAgent: {},

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
    set((state) => {
      const remainingChecks = { ...state.authChecks }
      const remainingCheckErrors = { ...state.authCheckErrors }
      delete remainingChecks[agentId]
      delete remainingCheckErrors[agentId]
      return {
        installed: state.installed.filter((a) => a.registryId !== agentId),
        authChecks: remainingChecks,
        authCheckErrors: remainingCheckErrors
      }
    })
  },

  loadInstalled: async () => {
    const installed = await window.api.invoke('agent:list-installed', undefined)
    set({ installed })
  },

  launchAgent: async (agentId: string, projectPath: string, extraEnv?: Record<string, string>) => {
    if (!extraEnv || Object.keys(extraEnv).length === 0) {
      const authResult = await get().checkAgentAuth(agentId, projectPath)
      if (!authResult.isAuthenticated) {
        throw new Error(authResult.error || 'Authentication required')
      }
      return authResult.connection
    }

    const connection = await window.api.invoke('agent:launch', { agentId, projectPath, extraEnv })
    set((state) => ({
      connections: [
        ...state.connections.filter((existing) => existing.connectionId !== connection.connectionId),
        connection
      ]
    }))
    return connection
  },

  checkAgentAuth: async (agentId: string, projectPath?: string) => {
    try {
      const result = await window.api.invoke('agent:check-auth', { agentId, projectPath })
      const normalizedResult: AgentAuthCheckResult = {
        ...result,
        error: result.error ? sanitizeAgentCheckErrorMessage(result.error) : undefined
      }
      set((state) => {
        const nextErrors = { ...state.authCheckErrors }
        delete nextErrors[agentId]
        return {
          authChecks: {
            ...state.authChecks,
            [agentId]: normalizedResult
          },
          authCheckErrors: nextErrors,
          connections: [
            ...state.connections.filter(
              (existing) => existing.connectionId !== normalizedResult.connection.connectionId
            ),
            normalizedResult.connection
          ]
        }
      })
      return normalizedResult
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = sanitizeAgentCheckErrorMessage(rawMessage)
      set((state) => ({
        authCheckErrors: {
          ...state.authCheckErrors,
          [agentId]: message
        }
      }))
      throw error
    }
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
      const authResult = await get().checkAgentAuth(agentId, projectPath)
      if (!authResult.isAuthenticated) {
        throw new Error(authResult.error || 'Authentication required')
      }

      const catalog = await window.api.invoke('agent:get-models', { agentId, projectPath })
      set((state) => ({
        modelsByAgent: { ...state.modelsByAgent, [agentId]: catalog },
        modelsLoadingByAgent: { ...state.modelsLoadingByAgent, [agentId]: false },
        modelErrorsByAgent: { ...state.modelErrorsByAgent, [agentId]: '' }
      }))
      return catalog
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = sanitizeAgentCheckErrorMessage(rawMessage)
      set((state) => ({
        modelsLoadingByAgent: { ...state.modelsLoadingByAgent, [agentId]: false },
        modelErrorsByAgent: { ...state.modelErrorsByAgent, [agentId]: message }
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
      const authResult = await get().checkAgentAuth(agentId, projectPath)
      if (!authResult.isAuthenticated) {
        throw new Error(authResult.error || 'Authentication required')
      }

      const catalog = await window.api.invoke('agent:get-modes', { agentId, projectPath })
      set((state) => ({
        modesByAgent: { ...state.modesByAgent, [agentId]: catalog },
        modesLoadingByAgent: { ...state.modesLoadingByAgent, [agentId]: false },
        modeErrorsByAgent: { ...state.modeErrorsByAgent, [agentId]: '' }
      }))
      return catalog
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = sanitizeAgentCheckErrorMessage(rawMessage)
      set((state) => ({
        modesLoadingByAgent: { ...state.modesLoadingByAgent, [agentId]: false },
        modeErrorsByAgent: { ...state.modeErrorsByAgent, [agentId]: message }
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
