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
  InteractionMode
} from '@shared/types/session'
import { useWorkspaceStore } from './workspace-store'
import { useProjectStore } from './project-store'
import { useAgentStore } from './agent-store'

function isInteractionMode(value: string): value is InteractionMode {
  return value === 'ask' || value === 'code' || value === 'plan' || value === 'act'
}

/** A draft thread that hasn't been created yet — lives only in UI state. */
export interface DraftThread {
  id: string
  workspaceId: string
  workspacePath: string
  agentId: string | null
  modelId: string | null
  interactionMode: InteractionMode | null
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
    interactionMode?: InteractionMode,
    modelId?: string,
    title?: string,
    pendingPrompt?: string
  ) => Promise<SessionInfo>
  setSessionInteractionMode: (sessionId: string, mode: InteractionMode) => Promise<void>
  setActiveSession: (sessionId: string | null) => void
  sendPrompt: (content: ContentBlock[], mode?: InteractionMode) => Promise<void>
  cancelPrompt: () => Promise<void>
  handleSessionUpdate: (event: SessionUpdateEvent) => void
  handlePermissionRequest: (event: PermissionRequestEvent) => void
  handleHookProgress: (event: WorktreeHookProgressEvent) => void
  respondToPermission: (requestId: string, optionId: string) => void

  // Persistence actions
  loadPersistedSessions: () => Promise<void>
  deleteSession: (sessionId: string, cleanupWorktree: boolean) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  generateTitle: (sessionId: string) => Promise<string | null>
  forkSession: (sessionId: string, title?: string) => Promise<SessionInfo>

  // Draft thread actions
  startDraftThread: (workspaceId: string, workspacePath: string) => void
  updateDraftThread: (
    updates: Partial<Pick<DraftThread, 'agentId' | 'modelId' | 'interactionMode' | 'useWorktree' | 'workspaceId' | 'workspacePath'>>
  ) => void
  discardDraftThread: () => void
  commitDraftThread: (prompt?: string) => Promise<void>
  retryInitialization: (sessionId: string) => void

  // Helpers
  getActiveSession: () => SessionInfo | undefined
  getSessionsByWorkspace: (workspaceId: string) => SessionInfo[]
}

/** Guard to prevent duplicate reconnect attempts for the same session. */
const reconnectingIds = new Set<string>()
const promptQueueBySession = new Map<string, Array<{ content: ContentBlock[]; mode?: InteractionMode }>>()
const processingPromptSessions = new Set<string>()

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
        interactionMode: t.interactionMode,
        useWorktree: t.useWorktree,
        workspaceId: t.workspaceId,
        parentSessionId: t.parentSessionId
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
          // Remove the session and promote orphaned children to root level
          sessions: state.sessions
            .filter((s) => s.sessionId !== sessionId)
            .map((s) =>
              s.parentSessionId === sessionId
                ? { ...s, parentSessionId: undefined }
                : s
            ),
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

  generateTitle: async (sessionId) => {
    try {
      const title = await window.api.invoke('session:generate-title', { sessionId })
      if (title) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.sessionId === sessionId ? { ...s, title } : s
          )
        }))
      }
      return title
    } catch (error) {
      console.error('Failed to generate title:', error)
      return null
    }
  },

  forkSession: async (sessionId, title?) => {
    try {
      const session = await window.api.invoke('session:fork', { sessionId, title })
      console.log('[forkSession] Got session from IPC:', session)
      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: session.sessionId
      }))
      console.log('[forkSession] State updated, sessions count:', get().sessions.length)
      return session
    } catch (error) {
      console.error('Failed to fork session:', error)
      throw error
    }
  },

  createSession: async (connectionId, workingDir, useWorktree, workspaceId, interactionMode, modelId, title, pendingPrompt?) => {
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
      interactionMode: interactionMode,
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
        interactionMode,
        modelId,
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

  setSessionInteractionMode: async (sessionId, mode) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, interactionMode: mode } : s
      )
    }))
    try {
      await window.api.invoke('session:set-interaction-mode', { sessionId, mode })
    } catch (error) {
      console.error('Failed to persist interaction mode:', error)
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

        // Proactively reconnect idle/disconnected sessions so the agent is ready
        if (session.status === 'idle' && !session.connectionId && !reconnectingIds.has(sessionId)) {
          reconnectingIds.add(sessionId)
          window.api.invoke('session:ensure-connected', { sessionId })
            .catch((err) => {
              console.warn('[session-store] Background reconnect failed:', err)
            })
            .finally(() => {
              reconnectingIds.delete(sessionId)
            })
        }
      }
    }
  },

sendPrompt: async (content, mode) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return

    // Optimistically add user message
    const userMessage: Message = {
      id: uuid(),
      role: 'user',
      content: content,
      timestamp: new Date().toISOString()
    }

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === activeSessionId
          ? { ...s, status: 'prompting' as const, lastError: undefined, messages: [...s.messages, userMessage] }
          : s
      )
    }))

    const queue = promptQueueBySession.get(activeSessionId) ?? []
    queue.push({ content, mode })
    promptQueueBySession.set(activeSessionId, queue)

    if (processingPromptSessions.has(activeSessionId)) {
      return
    }

    processingPromptSessions.add(activeSessionId)

    try {
      while ((promptQueueBySession.get(activeSessionId)?.length ?? 0) > 0) {
        const next = promptQueueBySession.get(activeSessionId)?.shift()
        if (!next) continue

        const currentSession = get().sessions.find((s) => s.sessionId === activeSessionId)
        const effectiveMode = next.mode ?? currentSession?.interactionMode

        try {
          await window.api.invoke('session:prompt', {
            sessionId: activeSessionId,
            content: next.content,
            mode: effectiveMode
          })

          const hasPendingItems = (promptQueueBySession.get(activeSessionId)?.length ?? 0) > 0
          // Prompt completed successfully. Treat this as a hard turn boundary:
          // if an agent failed to emit terminal tool updates, close remaining open calls.
          set((state) => ({
            sessions: state.sessions.map((s) => {
              if (s.sessionId !== activeSessionId) return s
              const messages = s.messages.map((m) => {
                const hasOpenToolCalls = m.toolCalls?.some((tc) => isOpenToolCallStatus(tc.status)) ?? false
                if (!m.isStreaming && !hasOpenToolCalls) return m
                return {
                  ...m,
                  isStreaming: false,
                  toolCalls: m.toolCalls?.map((tc) => ({
                    ...tc,
                    status: isOpenToolCallStatus(tc.status) ? ('completed' as const) : tc.status
                  }))
                }
              })
              return {
                ...s,
                status: hasPendingItems ? ('prompting' as const) : ('active' as const),
                lastError: undefined,
                messages
              }
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
      }
    } finally {
      processingPromptSessions.delete(activeSessionId)
      promptQueueBySession.delete(activeSessionId)
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
      modelId: null,
      interactionMode: null,
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

  commitDraftThread: async (prompt?: string) => {
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
      interactionMode: draftThread.interactionMode || undefined,
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
      modelId: draftThread.modelId,
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
      modelId: undefined,
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
  modelId?: string | null
  interactionMode?: InteractionMode
  workspacePath: string
  useWorktree: boolean
  workspaceId: string
  prompt?: string
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
  const { agentId, modelId, workspacePath, useWorktree, workspaceId, prompt, existingConnection } = params
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
      workspaceId,
      interactionMode: params.interactionMode,
      modelId: modelId || undefined
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

    // Send the first prompt if one was provided.
    if (prompt && prompt.trim().length > 0) {
      await get().sendPrompt([{ type: 'text', text: prompt }])
    }
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
      const normalizedSession = finalizeOpenToolCalls(session)
      const newMsg: Message = {
        id: update.messageId,
        role: 'agent',
        content: [],
        timestamp: new Date().toISOString(),
        isStreaming: true
      }
      return { ...normalizedSession, messages: [...normalizedSession.messages, newMsg] }
    }

    case 'text_chunk': {
      if (!update.text) return session
      return replaceAgentMessage(session, update.messageId, (msg) => {
        const normalizedMessage = finalizeOpenToolCallsInMessage(msg)
        const lastBlock =
          normalizedMessage.content.length > 0
            ? normalizedMessage.content[normalizedMessage.content.length - 1]
            : null
        if (lastBlock && lastBlock.type === 'text') {
          const newContent = [...normalizedMessage.content]
          newContent[newContent.length - 1] = { type: 'text', text: lastBlock.text + update.text }
          return { ...normalizedMessage, content: newContent }
        }
        return { ...normalizedMessage, content: [...normalizedMessage.content, { type: 'text', text: update.text }] }
      })
    }

    case 'thinking_chunk': {
      if (!update.text) return session
      return replaceAgentMessage(session, update.messageId, (msg) => {
        const normalizedMessage = finalizeOpenToolCallsInMessage(msg)
        const lastBlock =
          normalizedMessage.content.length > 0
            ? normalizedMessage.content[normalizedMessage.content.length - 1]
            : null
        if (lastBlock && lastBlock.type === 'thinking') {
          const newContent = [...normalizedMessage.content]
          newContent[newContent.length - 1] = { type: 'thinking', text: lastBlock.text + update.text }
          return { ...normalizedMessage, content: newContent }
        }
        return { ...normalizedMessage, content: [...normalizedMessage.content, { type: 'thinking', text: update.text }] }
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
        const ref: ContentBlock = { type: 'tool_call_ref', toolCallId: update.toolCall.toolCallId }
        return {
          ...msg,
          content: [...msg.content, ref],
          toolCalls: [...(msg.toolCalls || []), update.toolCall]
        }
      })
    }

    case 'tool_call_update': {
      let didUpdateById = false
      const updatedById = session.messages.map((msg) => {
        if (!msg.toolCalls) return msg
        const tcIdx = msg.toolCalls.findIndex((t) => t.toolCallId === update.toolCallId)
        if (tcIdx < 0) return msg
        didUpdateById = true
        const newToolCalls = [...msg.toolCalls]
        newToolCalls[tcIdx] = {
          ...newToolCalls[tcIdx],
          status: update.status,
          ...(update.output != null ? { output: update.output } : {}),
          ...(update.locations ? { locations: update.locations } : {})
        }
        return { ...msg, toolCalls: newToolCalls }
      })
      if (didUpdateById) return { ...session, messages: updatedById }

      // Fallback for agents that emit tool_call_update with missing/mismatched toolCallId:
      // if exactly one open tool call exists, apply the update to that call.
      const openToolCalls: Array<{ messageIndex: number; toolCallIndex: number }> = []
      for (let mi = 0; mi < session.messages.length; mi++) {
        const toolCalls = session.messages[mi].toolCalls
        if (!toolCalls) continue
        for (let ti = 0; ti < toolCalls.length; ti++) {
          if (isOpenToolCallStatus(toolCalls[ti].status)) {
            openToolCalls.push({ messageIndex: mi, toolCallIndex: ti })
          }
        }
      }
      if (openToolCalls.length !== 1) return session

      const [{ messageIndex, toolCallIndex }] = openToolCalls
      const messages = session.messages.map((msg, mi) => {
        if (mi !== messageIndex || !msg.toolCalls) return msg
        const newToolCalls = [...msg.toolCalls]
        newToolCalls[toolCallIndex] = {
          ...newToolCalls[toolCallIndex],
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
        (m.id === update.messageId || m.isStreaming)
          ? {
              ...m,
              isStreaming: false,
              toolCalls: m.toolCalls?.map((tc) =>
                ({
                  ...tc,
                  status:
                    tc.status === 'pending' || tc.status === 'in_progress' || tc.status === 'running'
                      ? ('completed' as const)
                      : tc.status
                })
              )
            }
          : m
      )
      return { ...session, messages, status: 'active' }
    }

    case 'status_change': {
      const nextSession = update.status === 'active' ? finalizeOpenToolCalls(session) : session
      return { ...nextSession, status: update.status }
    }

    case 'error':
      return { ...session, status: 'error' }

    // ACP spec: mode/config/command/plan/usage updates — consumed by acp-features-store
    case 'current_mode_update':
      return isInteractionMode(update.modeId)
        ? { ...session, interactionMode: update.modeId }
        : session

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

function isOpenToolCallStatus(status: 'pending' | 'in_progress' | 'running' | 'completed' | 'failed'): boolean {
  return status === 'pending' || status === 'in_progress' || status === 'running'
}

function finalizeOpenToolCallsInMessage(message: Message): Message {
  const toolCalls = message.toolCalls
  if (!toolCalls || toolCalls.length === 0) return message

  let didChange = false
  const normalizedToolCalls = toolCalls.map((toolCall) => {
    if (!isOpenToolCallStatus(toolCall.status)) return toolCall
    didChange = true
    return { ...toolCall, status: 'completed' as const }
  })

  if (!didChange && !message.isStreaming) return message
  return { ...message, toolCalls: normalizedToolCalls, isStreaming: false }
}

function finalizeOpenToolCalls(session: SessionInfo): SessionInfo {
  let didChange = false
  const messages = session.messages.map((message) => {
    const normalized = finalizeOpenToolCallsInMessage(message)
    if (normalized !== message) didChange = true
    return normalized
  })
  return didChange ? { ...session, messages } : session
}
