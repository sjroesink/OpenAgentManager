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
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...(state.sessions[sessionId] || EMPTY_STATE),
              currentModeId: update.modeId
            }
          }
        }))
        break

      case 'config_options_update':
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...(state.sessions[sessionId] || EMPTY_STATE),
              configOptions: update.options
            }
          }
        }))
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
    const result = await window.api.invoke('session:set-config-option', { sessionId, configId, value })
    // Response contains the full updated config options list
    if (Array.isArray(result)) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...(state.sessions[sessionId] || EMPTY_STATE),
            configOptions: result
          }
        }
      }))
    }
  }
}))
