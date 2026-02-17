import { create } from 'zustand'
import type {
  SessionUpdate,
  ConfigOption,
  SlashCommand,
  PlanEntry,
  UsageUpdate
} from '@shared/types/session'

/**
 * ACP Features Store — tracks per-session ACP protocol state:
 * - Session modes & config options
 * - Slash commands
 * - Agent plan
 * - Usage/context tracking
 */

interface AcpSessionState {
  currentModeId: string | null
  configOptions: ConfigOption[]
  commands: SlashCommand[]
  plan: PlanEntry[]
  usage: UsageUpdate | null
  title: string | null
}

interface AcpFeaturesState {
  /** Per-session ACP state. Key = sessionId. */
  sessions: Record<string, AcpSessionState>

  /** Apply a session update (called from handleSessionUpdate) */
  applyUpdate: (sessionId: string, update: SessionUpdate) => void

  /** Get ACP state for a session */
  getSessionState: (sessionId: string) => AcpSessionState | undefined

  /** Set mode via IPC */
  setMode: (sessionId: string, modeId: string) => Promise<void>

  /** Set config option via IPC */
  setConfigOption: (sessionId: string, configId: string, value: string) => Promise<void>
}

const EMPTY_STATE: AcpSessionState = {
  currentModeId: null,
  configOptions: [],
  commands: [],
  plan: [],
  usage: null,
  title: null
}

export const useAcpFeaturesStore = create<AcpFeaturesState>((set, get) => ({
  sessions: {},

  applyUpdate: (sessionId, update) => {
    switch (update.type) {
      case 'current_mode_update':
        set((state) => {
          const existing = state.sessions[sessionId] || EMPTY_STATE
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                currentModeId: update.modeId,
                // Keep mode selector in sync when the agent reports a mode change.
                configOptions: existing.configOptions.map((opt) =>
                  opt.category === 'mode' ? { ...opt, currentValue: update.modeId } : opt
                )
              }
            }
          }
        })
        break

      case 'config_options_update':
        set((state) => {
          const existing = state.sessions[sessionId] || EMPTY_STATE
          // Merge: incoming options replace existing ones with the same id, new ones are appended
          const merged = [...existing.configOptions]
          for (const incoming of update.options) {
            const idx = merged.findIndex((o) => o.id === incoming.id)
            if (idx >= 0) {
              merged[idx] = incoming
            } else {
              merged.push(incoming)
            }
          }
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                configOptions: merged
              }
            }
          }
        })
        break

      case 'available_commands_update':
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...(state.sessions[sessionId] || EMPTY_STATE),
              commands: update.commands
            }
          }
        }))
        break

      case 'plan_update':
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...(state.sessions[sessionId] || EMPTY_STATE),
              plan: update.entries
            }
          }
        }))
        break

      case 'usage_update':
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...(state.sessions[sessionId] || EMPTY_STATE),
              usage: update.usage
            }
          }
        }))
        break

      case 'session_info_update':
        set((state) => {
          const existing = state.sessions[sessionId] || EMPTY_STATE
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                ...(update.title !== undefined ? { title: update.title } : {})
              }
            }
          }
        })
        break
    }
  },

  getSessionState: (sessionId) => {
    return get().sessions[sessionId]
  },

  setMode: async (sessionId, modeId) => {
    await window.api.invoke('session:set-mode', { sessionId, modeId })
  },

  setConfigOption: async (sessionId, configId, value) => {
    // Snapshot for rollback on error
    const prevOptions = (get().sessions[sessionId] || EMPTY_STATE).configOptions

    // Optimistic update: immediately reflect the selection in the UI
    set((state) => {
      const existing = state.sessions[sessionId] || EMPTY_STATE
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            configOptions: existing.configOptions.map((opt) =>
              opt.id === configId ? { ...opt, currentValue: value } : opt
            )
          }
        }
      }
    })

    try {
      // For legacy mode options (synthesized from session/new modes field), use session/set_mode
      const configOption = prevOptions.find((o) => o.id === configId)
      if (configOption?.category === 'mode' && configId === '_mode') {
        await window.api.invoke('session:set-mode', { sessionId, modeId: value })
        return
      }

      // For legacy model options (synthesized from session/new models field), use session/set_model
      if (configOption?.category === 'model' && configId === '_model') {
        await window.api.invoke('session:set-model', { sessionId, modelId: value })
        return
      }

      const result = await window.api.invoke('session:set-config-option', { sessionId, configId, value })
      // Response contains the full updated config options list — reconcile with server state
      if (Array.isArray(result)) {
        set((state) => {
          const existing = state.sessions[sessionId] || EMPTY_STATE
          // Merge server response with any locally-known options
          const merged = [...existing.configOptions]
          for (const incoming of result as typeof existing.configOptions) {
            const idx = merged.findIndex((o) => o.id === incoming.id)
            if (idx >= 0) {
              merged[idx] = incoming
            } else {
              merged.push(incoming)
            }
          }
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                configOptions: merged
              }
            }
          }
        })
      }
    } catch (error) {
      // Revert optimistic update on failure
      console.warn('[acp-features-store] setConfigOption failed, reverting:', error)
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...(state.sessions[sessionId] || EMPTY_STATE),
            configOptions: prevOptions
          }
        }
      }))
    }
  }
}))
