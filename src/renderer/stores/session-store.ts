import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type {
  SessionInfo,
  PersistedThread,
  SessionUpdate,
  SessionUpdateEvent,
  PermissionRequestEvent,
  PermissionResponse,
  WorktreeHookProgressEvent,
  HookStep,
  Message,
  ContentBlock,
  ToolCallInfo,
  InteractionMode
} from '@shared/types/session'
import { useWorkspaceStore } from './workspace-store'
import { useProjectStore } from './project-store'
import { useAgentStore } from './agent-store'

/** A draft thread that hasn't been created yet — lives only in UI state. */
export interface DraftThread {
  id: string
  workspaceId: string
  workspacePath: string
  agentId: string | null
  useWorktree: boolean
}

interface SessionState {
  sessions: SessionInfo[]
  activeSessionId: string | null
  pendingPermissions: PermissionRequestEvent[]
  hookProgress: Record<string, WorktreeHookProgressEvent>
  deletingSessionIds: Set<string>

  // Draft thread (inline "new thread" in sidebar)
  draftThread: DraftThread | null
  activeDraftId: string | null

  // Actions
  createSession: (
    connectionId: string,
    workingDir: string,
    useWorktree: boolean,
    workspaceId: string,
    title?: string,
    pendingPrompt?: string
  ) => Promise<SessionInfo>
  setActiveSession: (sessionId: string | null) => void
  sendPrompt: (text: string, mode?: InteractionMode) => Promise<void>
  cancelPrompt: () => Promise<void>
  handleSessionUpdate: (event: SessionUpdateEvent) => void
  handlePermissionRequest: (event: PermissionRequestEvent) => void
  handleHookProgress: (event: WorktreeHookProgressEvent) => void
  respondToPermission: (requestId: string, optionId: string) => void

  // Persistence actions
  loadPersistedSessions: () => Promise<void>
  deleteSession: (sessionId: string, cleanupWorktree: boolean) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>

  // Draft thread actions
  startDraftThread: (workspaceId: string, workspacePath: string) => void
  updateDraftThread: (updates: Partial<Pick<DraftThread, 'agentId' | 'useWorktree' | 'workspaceId' | 'workspacePath'>>) => void
  discardDraftThread: () => void
  commitDraftThread: (prompt: string) => Promise<void>
  retryInitialization: (sessionId: string) => void

  // Helpers
  getActiveSession: () => SessionInfo | undefined
  getSessionsByWorkspace: (workspaceId: string) => SessionInfo[]
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  pendingPermissions: [],
  hookProgress: {},
  deletingSessionIds: new Set<string>(),
  draftThread: null,
  activeDraftId: null,

  loadPersistedSessions: async () => {
    try {
      const threads: PersistedThread[] = await window.api.invoke('session:list-persisted', undefined)
      if (threads.length === 0) return

      const restoredSessions: SessionInfo[] = threads.map((t) => ({
        sessionId: t.sessionId,
        connectionId: '', // No active connection
        agentId: t.agentId,
        agentName: t.agentName,
        title: t.title,
        createdAt: t.createdAt,
        worktreePath: t.worktreePath,
        worktreeBranch: t.worktreeBranch,
        workingDir: t.workingDir,
        status: 'idle' as const,
        messages: t.messages,
        useWorktree: t.useWorktree,
        workspaceId: t.workspaceId
      }))

      set((state) => {
        // Merge: don't duplicate sessions already in memory
        const existingIds = new Set(state.sessions.map((s) => s.sessionId))
        const newSessions = restoredSessions.filter((s) => !existingIds.has(s.sessionId))
        return { sessions: [...state.sessions, ...newSessions] }
      })
    } catch (error) {
      console.error('Failed to load persisted sessions:', error)
    }
  },

  deleteSession: async (sessionId, cleanupWorktree) => {
    set((state) => ({
      deletingSessionIds: new Set([...state.deletingSessionIds, sessionId])
    }))
    try {
      await window.api.invoke('session:remove', { sessionId, cleanupWorktree })
      set((state) => {
        const next = new Set(state.deletingSessionIds)
        next.delete(sessionId)
        return {
          sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
          activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
          deletingSessionIds: next
        }
      })
    } catch (error) {
      console.error('Failed to delete session:', error)
      set((state) => {
        const next = new Set(state.deletingSessionIds)
        next.delete(sessionId)
        return { deletingSessionIds: next }
      })
    }
  },

  renameSession: async (sessionId, title) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, title } : s
      )
    }))
    try {
      await window.api.invoke('session:rename', { sessionId, title })
    } catch (error) {
      console.error('Failed to rename session:', error)
    }
  },

  createSession: async (connectionId, workingDir, useWorktree, workspaceId, title, pendingPrompt?) => {
    // Add a placeholder session immediately so the UI feels responsive
    const placeholderId = `creating-${uuid().slice(0, 8)}`
    const placeholder: SessionInfo = {
      sessionId: placeholderId,
      connectionId,
      agentId: '',
      agentName: 'Connecting...',
      title: title || 'New Thread',
      createdAt: new Date().toISOString(),
      workingDir,
      status: 'creating',
      messages: [],
      useWorktree,
      workspaceId,
      pendingPrompt
    }
    set((state) => ({
      sessions: [...state.sessions, placeholder],
      activeSessionId: placeholderId
    }))

    try {
      const session = await window.api.invoke('session:create', {
        connectionId,
        workingDir,
        useWorktree,
        workspaceId,
        title
      })
      // Replace placeholder with actual session
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === placeholderId ? session : s
        ),
        activeSessionId: session.sessionId
      }))
      return session
    } catch (error) {
      // Remove placeholder on failure
      set((state) => ({
        sessions: state.sessions.filter((s) => s.sessionId !== placeholderId),
        activeSessionId: state.activeSessionId === placeholderId ? null : state.activeSessionId
      }))
      throw error
    }
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId, activeDraftId: null })

    // Bridge: sync project-store with the active session's workspace
    if (sessionId) {
      const session = get().sessions.find((s) => s.sessionId === sessionId)
      if (session) {
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

  sendPrompt: async (text, mode) => {
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
          ? { ...s, status: 'prompting' as const, lastError: undefined, messages: [...s.messages, userMessage] }
          : s
      )
    }))

    try {
      await window.api.invoke('session:prompt', { sessionId: activeSessionId, text, mode })

      // Prompt completed successfully — mark session as active and finalize streaming message
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.sessionId !== activeSessionId) return s
          const messages = s.messages.map((m) =>
            m.isStreaming ? { ...m, isStreaming: false } : m
          )
          return { ...s, status: 'active' as const, lastError: undefined, messages }
        })
      }))

      // Auto-generate title after first agent response if title is still default
      const session = get().sessions.find((s) => s.sessionId === activeSessionId)
      if (session) {
        const isDefaultTitle =
          session.title === 'New Thread' || /^Session [a-f0-9]{8}$/.test(session.title)
        const userMessages = session.messages.filter((m) => m.role === 'user')
        if (isDefaultTitle && userMessages.length === 1) {
          // Fire-and-forget: title comes back via session_info_update event
          window.api.invoke('session:generate-title', { sessionId: activeSessionId }).catch(() => {})
        }
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Prompt failed'
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === activeSessionId
            ? { ...s, status: 'error' as const, lastError: errorMessage }
            : s
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
    try {
      const { sessionId, update } = event
      if (!sessionId || !update || !update.type) return

      set((state) => ({
        sessions: state.sessions.map((session) => {
          if (session.sessionId !== sessionId) return session
          try {
            return applyUpdate(session, update)
          } catch (err) {
            console.error('[session-store] Error applying update:', err, update)
            return session
          }
        })
      }))
    } catch (err) {
      console.error('[session-store] Error handling session update:', err)
    }
  },

  handlePermissionRequest: (event) => {
    try {
      if (!event || !event.requestId) return
      set((state) => ({
        pendingPermissions: [...state.pendingPermissions, event]
      }))
    } catch (err) {
      console.error('[session-store] Error handling permission request:', err)
    }
  },

  handleHookProgress: (event) => {
    try {
      if (!event || !event.sessionId) return
      set((state) => ({
        hookProgress: { ...state.hookProgress, [event.sessionId]: event }
      }))
    } catch (err) {
      console.error('[session-store] Error handling hook progress:', err)
    }
  },

  respondToPermission: (requestId, optionId) => {
    const response: PermissionResponse = { requestId, optionId }
    window.api.invoke('session:permission-response', response)

    set((state) => ({
      pendingPermissions: state.pendingPermissions.filter((p) => p.requestId !== requestId)
    }))
  },

  // ---- Draft thread actions ----

  startDraftThread: (workspaceId, workspacePath) => {
    const draft: DraftThread = {
      id: `draft-${uuid().slice(0, 8)}`,
      workspaceId,
      workspacePath,
      agentId: null,
      useWorktree: false
    }
    set({ draftThread: draft, activeDraftId: draft.id, activeSessionId: null })
  },

  updateDraftThread: (updates) => {
    set((state) => {
      if (!state.draftThread) return state
      return { draftThread: { ...state.draftThread, ...updates } }
    })
  },

  discardDraftThread: () => {
    set({ draftThread: null, activeDraftId: null })
  },

  commitDraftThread: async (prompt: string) => {
    const { draftThread } = get()
    if (!draftThread || !draftThread.agentId) return

    const agentStore = useAgentStore.getState()
    const agentId = draftThread.agentId

    // Check if agent is already connected
    const existingConnection = agentStore.connections.find(
      (c: { agentId: string; status: string }) =>
        c.agentId === agentId && c.status === 'connected'
    )

    // Build init progress steps
    const initSteps: HookStep[] = existingConnection
      ? [{ label: 'Creating session', status: 'pending' as const }]
      : [
          { label: 'Launching agent', status: 'pending' as const },
          { label: 'Connecting', status: 'pending' as const },
          { label: 'Creating session', status: 'pending' as const }
        ]

    // Resolve agent display name
    const agentInfo = agentStore.installed.find(
      (a: { registryId: string }) => a.registryId === agentId
    )

    // Create placeholder immediately so the chat shows right away
    const placeholderId = `init-${uuid().slice(0, 8)}`
    const placeholder: SessionInfo = {
      sessionId: placeholderId,
      connectionId: '',
      agentId,
      agentName: agentInfo?.name || 'Agent',
      title: 'New Thread',
      createdAt: new Date().toISOString(),
      workingDir: draftThread.workspacePath,
      status: 'initializing',
      messages: [],
      useWorktree: draftThread.useWorktree,
      workspaceId: draftThread.workspaceId,
      pendingPrompt: prompt,
      initProgress: initSteps
    }

    // Clear draft and show placeholder — user sees the thread immediately
    set({
      draftThread: null,
      activeDraftId: null,
      sessions: [...get().sessions, placeholder],
      activeSessionId: placeholderId
    })

    // Run the initialization pipeline in the background
    runInitPipeline(set, get, placeholderId, {
      agentId,
      workspacePath: draftThread.workspacePath,
      useWorktree: draftThread.useWorktree,
      workspaceId: draftThread.workspaceId,
      prompt,
      existingConnection: existingConnection || null
    })
  },

  retryInitialization: (sessionId: string) => {
    const session = get().sessions.find((s) => s.sessionId === sessionId)
    if (!session || !session.pendingPrompt) return

    const agentStore = useAgentStore.getState()
    const existingConnection = agentStore.connections.find(
      (c: { agentId: string; status: string }) =>
        c.agentId === session.agentId && c.status === 'connected'
    )

    const initSteps: HookStep[] = existingConnection
      ? [{ label: 'Creating session', status: 'pending' as const }]
      : [
          { label: 'Launching agent', status: 'pending' as const },
          { label: 'Connecting', status: 'pending' as const },
          { label: 'Creating session', status: 'pending' as const }
        ]

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId
          ? { ...s, status: 'initializing' as const, initProgress: initSteps, initError: undefined }
          : s
      )
    }))

    runInitPipeline(set, get, sessionId, {
      agentId: session.agentId,
      workspacePath: session.workingDir,
      useWorktree: session.useWorktree,
      workspaceId: session.workspaceId,
      prompt: session.pendingPrompt,
      existingConnection: existingConnection || null
    })
  },

  // ---- Helpers ----

  getActiveSession: () => {
    const { sessions, activeSessionId } = get()
    return sessions.find((s) => s.sessionId === activeSessionId)
  },

  getSessionsByWorkspace: (workspaceId) => {
    return get().sessions.filter((s) => s.workspaceId === workspaceId)
  }
}))

// ---- Initialization pipeline (runs in background after commitDraftThread) ----

interface InitPipelineParams {
  agentId: string
  workspacePath: string
  useWorktree: boolean
  workspaceId: string
  prompt: string
  existingConnection: { connectionId: string } | null
}

type SetFn = (fn: SessionState | Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void
type GetFn = () => SessionState

function updateInitStep(
  set: SetFn,
  sessionId: string,
  stepLabel: string,
  newStatus: HookStep['status'],
  detail?: string
) {
  set((state) => ({
    sessions: state.sessions.map((s) => {
      if (s.sessionId !== sessionId || !s.initProgress) return s
      return {
        ...s,
        initProgress: s.initProgress.map((step) =>
          step.label === stepLabel ? { ...step, status: newStatus, detail } : step
        )
      }
    })
  }))
}

async function runInitPipeline(
  set: SetFn,
  get: GetFn,
  placeholderId: string,
  params: InitPipelineParams
) {
  const { agentId, workspacePath, useWorktree, workspaceId, prompt, existingConnection } = params
  const agentStore = useAgentStore.getState()

  try {
    let connection = existingConnection

    if (!connection) {
      // Step: Launching agent
      updateInitStep(set, placeholderId, 'Launching agent', 'running')
      const launched = await agentStore.launchAgent(agentId, workspacePath)
      updateInitStep(set, placeholderId, 'Launching agent', 'completed')

      // Step: Connecting (handshake is part of launchAgent)
      updateInitStep(set, placeholderId, 'Connecting', 'completed')
      connection = launched
    }

    // Step: Creating session
    updateInitStep(set, placeholderId, 'Creating session', 'running')
    const session = await window.api.invoke('session:create', {
      connectionId: connection.connectionId,
      workingDir: workspacePath,
      useWorktree,
      workspaceId
    })
    updateInitStep(set, placeholderId, 'Creating session', 'completed')

    // Replace placeholder with real session
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === placeholderId ? { ...session, pendingPrompt: prompt } : s
      ),
      activeSessionId:
        state.activeSessionId === placeholderId ? session.sessionId : state.activeSessionId
    }))

    // Send the first prompt
    await get().sendPrompt(prompt)
  } catch (error) {
    // Mark the running step as failed and set error status
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.sessionId !== placeholderId) return s
        const updatedSteps = (s.initProgress || []).map((step) =>
          step.status === 'running'
            ? { ...step, status: 'failed' as const, detail: (error as Error).message }
            : step
        )
        return {
          ...s,
          status: 'error' as const,
          initProgress: updatedSteps,
          initError: (error as Error).message
        }
      })
    }))
  }
}

/**
 * Apply a streaming update to a session — fully immutable.
 *
 * Every path that modifies a message produces a *new* Message object so
 * that React (via Zustand shallow-compare) sees the change and re-renders.
 */
function applyUpdate(session: SessionInfo, update: SessionUpdate): SessionInfo {
  switch (update.type) {
    case 'message_start': {
      const newMsg: Message = {
        id: update.messageId,
        role: 'agent',
        content: [],
        timestamp: new Date().toISOString(),
        isStreaming: true
      }
      return { ...session, messages: [...session.messages, newMsg] }
    }

    case 'text_chunk': {
      if (!update.text) return session
      return replaceAgentMessage(session, update.messageId, (msg) => {
        const lastIdx = findLastIndex(msg.content, (b) => b.type === 'text')
        if (lastIdx >= 0) {
          const block = msg.content[lastIdx] as { type: 'text'; text: string }
          const newContent = [...msg.content]
          newContent[lastIdx] = { type: 'text', text: block.text + update.text }
          return { ...msg, content: newContent }
        }
        return { ...msg, content: [...msg.content, { type: 'text', text: update.text }] }
      })
    }

    case 'thinking_chunk': {
      if (!update.text) return session
      return replaceAgentMessage(session, update.messageId, (msg) => {
        const lastIdx = findLastIndex(msg.content, (b) => b.type === 'thinking')
        if (lastIdx >= 0) {
          const block = msg.content[lastIdx] as { type: 'thinking'; text: string }
          const newContent = [...msg.content]
          newContent[lastIdx] = { type: 'thinking', text: block.text + update.text }
          return { ...msg, content: newContent }
        }
        return { ...msg, content: [...msg.content, { type: 'thinking', text: update.text }] }
      })
    }

    case 'tool_call_start': {
      return replaceAgentMessage(session, update.messageId, (msg) => {
        const existing = (msg.toolCalls || []).findIndex(
          (t) => t.toolCallId === update.toolCall.toolCallId
        )
        if (existing >= 0) {
          // Update existing tool call instead of duplicating
          const newToolCalls = [...msg.toolCalls!]
          newToolCalls[existing] = { ...newToolCalls[existing], ...update.toolCall }
          return { ...msg, toolCalls: newToolCalls }
        }
        return { ...msg, toolCalls: [...(msg.toolCalls || []), update.toolCall] }
      })
    }

    case 'tool_call_update': {
      const messages = session.messages.map((msg) => {
        if (!msg.toolCalls) return msg
        const tcIdx = msg.toolCalls.findIndex((t) => t.toolCallId === update.toolCallId)
        if (tcIdx < 0) return msg
        const newToolCalls = [...msg.toolCalls]
        newToolCalls[tcIdx] = {
          ...newToolCalls[tcIdx],
          status: update.status,
          ...(update.output != null ? { output: update.output } : {}),
          ...(update.locations ? { locations: update.locations } : {})
        }
        return { ...msg, toolCalls: newToolCalls }
      })
      return { ...session, messages }
    }

    case 'message_complete': {
      const messages = session.messages.map((m) =>
        (m.id === update.messageId || m.isStreaming) ? { ...m, isStreaming: false } : m
      )
      return { ...session, messages, status: 'active' }
    }

    case 'status_change':
      return { ...session, status: update.status }

    case 'error':
      return { ...session, status: 'error' }

    // ACP spec: mode/config/command/plan/usage updates — consumed by acp-features-store
    case 'current_mode_update':
    case 'config_options_update':
    case 'available_commands_update':
    case 'plan_update':
    case 'usage_update':
      return session

    // RFD: session_info_update — sync title to session
    case 'session_info_update': {
      if (update.title !== undefined && update.title !== null) {
        return { ...session, title: update.title }
      }
      return session
    }

    default:
      return session
  }
}

/** Find the last index in an array matching a predicate. */
function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i
  }
  return -1
}

/**
 * Immutably replace (or auto-create) the target agent message in session.messages.
 * `transform` receives the existing message and must return a *new* object.
 *
 * Only reuses an existing message if it appears AFTER the last user message,
 * ensuring agent responses don't get inserted above subsequent user prompts.
 */
function replaceAgentMessage(
  session: SessionInfo,
  messageId: string,
  transform: (msg: Message) => Message
): SessionInfo {
  const lastUserIdx = findLastIndex(session.messages, (m) => m.role === 'user')

  // Try to find by id first, but only if it's after the last user message
  let targetIdx = -1
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].id === messageId) {
      if (i > lastUserIdx) {
        targetIdx = i
      }
      break
    }
  }

  // Fall back to last streaming agent message (must be after last user message)
  if (targetIdx < 0) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (i <= lastUserIdx) break
      if (session.messages[i].role === 'agent' && session.messages[i].isStreaming) {
        targetIdx = i
        break
      }
    }
  }

  if (targetIdx >= 0) {
    const messages = [...session.messages]
    messages[targetIdx] = transform(messages[targetIdx])
    return { ...session, messages }
  }

  // No matching message after last user — create a new one at the end
  const newMsg: Message = {
    id: messageId === 'current' ? uuid() : (messageId || uuid()),
    role: 'agent',
    content: [],
    timestamp: new Date().toISOString(),
    isStreaming: true
  }
  return { ...session, messages: [...session.messages, transform(newMsg)] }
}
