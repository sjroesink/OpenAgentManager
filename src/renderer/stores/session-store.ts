import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type {
  SessionInfo,
  SessionUpdate,
  SessionUpdateEvent,
  PermissionRequestEvent,
  PermissionResponse,
  Message,
  ContentBlock,
  ToolCallInfo
} from '@shared/types/session'

interface SessionState {
  sessions: SessionInfo[]
  activeSessionId: string | null
  pendingPermissions: PermissionRequestEvent[]

  // Actions
  createSession: (
    connectionId: string,
    workingDir: string,
    useWorktree: boolean,
    workspaceId: string,
    title?: string
  ) => Promise<SessionInfo>
  setActiveSession: (sessionId: string | null) => void
  sendPrompt: (text: string) => Promise<void>
  cancelPrompt: () => Promise<void>
  handleSessionUpdate: (event: SessionUpdateEvent) => void
  handlePermissionRequest: (event: PermissionRequestEvent) => void
  respondToPermission: (requestId: string, approved: boolean, remember?: boolean) => void

  // Helpers
  getActiveSession: () => SessionInfo | undefined
  getSessionsByWorkspace: (workspaceId: string) => SessionInfo[]
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  pendingPermissions: [],

  createSession: async (connectionId, workingDir, useWorktree, workspaceId, title) => {
    const session = await window.api.invoke('session:create', {
      connectionId,
      workingDir,
      useWorktree,
      workspaceId,
      title
    })
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: session.sessionId
    }))
    return session
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId })

    // Bridge: sync project-store with the active session's workspace
    if (sessionId) {
      const session = get().sessions.find((s) => s.sessionId === sessionId)
      if (session) {
        const { useWorkspaceStore } = require('./workspace-store')
        const { useProjectStore } = require('./project-store')
        const workspace = useWorkspaceStore.getState().workspaces.find(
          (w: { id: string }) => w.id === session.workspaceId
        )
        if (workspace) {
          useProjectStore.getState().openProject(workspace.path)
          useWorkspaceStore.getState().touchWorkspace(workspace.id)
        }
      }
    }
  },

  sendPrompt: async (text) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return

    // Optimistically add user message
    const userMessage: Message = {
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: new Date().toISOString()
    }

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === activeSessionId
          ? { ...s, status: 'prompting' as const, messages: [...s.messages, userMessage] }
          : s
      )
    }))

    try {
      await window.api.invoke('session:prompt', { sessionId: activeSessionId, text })

      // Prompt completed successfully — mark session as active and finalize streaming message
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.sessionId !== activeSessionId) return s
          const messages = s.messages.map((m) =>
            m.isStreaming ? { ...m, isStreaming: false } : m
          )
          return { ...s, status: 'active' as const, messages }
        })
      }))
    } catch (error) {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === activeSessionId ? { ...s, status: 'error' as const } : s
        )
      }))
    }
  },

  cancelPrompt: async () => {
    const { activeSessionId } = get()
    if (!activeSessionId) return
    await window.api.invoke('session:cancel', { sessionId: activeSessionId })
  },

  handleSessionUpdate: (event: SessionUpdateEvent) => {
    const { sessionId, update } = event

    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.sessionId !== sessionId) return session
        return applyUpdate(session, update)
      })
    }))
  },

  handlePermissionRequest: (event) => {
    set((state) => ({
      pendingPermissions: [...state.pendingPermissions, event]
    }))
  },

  respondToPermission: (requestId, approved, remember) => {
    const response: PermissionResponse = { requestId, approved, remember }
    window.api.invoke('session:permission-response', response)

    set((state) => ({
      pendingPermissions: state.pendingPermissions.filter((p) => p.requestId !== requestId)
    }))
  },

  getActiveSession: () => {
    const { sessions, activeSessionId } = get()
    return sessions.find((s) => s.sessionId === activeSessionId)
  },

  getSessionsByWorkspace: (workspaceId) => {
    return get().sessions.filter((s) => s.workspaceId === workspaceId)
  }
}))

/** Apply a streaming update to a session */
function applyUpdate(session: SessionInfo, update: SessionUpdate): SessionInfo {
  const messages = [...session.messages]

  switch (update.type) {
    case 'message_start': {
      messages.push({
        id: update.messageId,
        role: 'agent',
        content: [],
        timestamp: new Date().toISOString(),
        isStreaming: true
      })
      return { ...session, messages }
    }

    case 'text_chunk': {
      const lastMsg = findOrCreateAgentMessage(messages, update.messageId)
      const lastTextBlock = lastMsg.content.findLast((b): b is { type: 'text'; text: string } => b.type === 'text')
      if (lastTextBlock) {
        lastTextBlock.text += update.text
      } else {
        lastMsg.content.push({ type: 'text', text: update.text })
      }
      return { ...session, messages }
    }

    case 'thinking_chunk': {
      const lastMsg = findOrCreateAgentMessage(messages, update.messageId)
      const lastThinking = lastMsg.content.findLast((b): b is { type: 'thinking'; text: string } => b.type === 'thinking')
      if (lastThinking) {
        lastThinking.text += update.text
      } else {
        lastMsg.content.push({ type: 'thinking', text: update.text })
      }
      return { ...session, messages }
    }

    case 'tool_call_start': {
      const lastMsg = findOrCreateAgentMessage(messages, update.messageId)
      if (!lastMsg.toolCalls) lastMsg.toolCalls = []
      lastMsg.toolCalls.push(update.toolCall)
      return { ...session, messages }
    }

    case 'tool_call_update': {
      for (const msg of messages) {
        if (msg.toolCalls) {
          const tc = msg.toolCalls.find((t) => t.toolCallId === update.toolCallId)
          if (tc) {
            tc.status = update.status
            if (update.output) tc.output = update.output
            break
          }
        }
      }
      return { ...session, messages }
    }

    case 'message_complete': {
      const msg = messages.find((m) => m.id === update.messageId || m.isStreaming)
      if (msg) {
        msg.isStreaming = false
      }
      return { ...session, messages, status: 'active' }
    }

    case 'status_change':
      return { ...session, status: update.status }

    case 'error':
      return { ...session, status: 'error' }

    default:
      return session
  }
}

function findOrCreateAgentMessage(messages: Message[], messageId: string): Message {
  let msg = messages.find((m) => m.id === messageId)
  if (!msg) {
    // Find the last streaming agent message or create one
    msg = messages.findLast((m) => m.role === 'agent' && m.isStreaming)
    if (!msg) {
      msg = {
        id: messageId || uuid(),
        role: 'agent',
        content: [],
        timestamp: new Date().toISOString(),
        isStreaming: true
      }
      messages.push(msg)
    }
  }
  return msg
}
