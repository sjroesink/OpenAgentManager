import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type {
  SessionInfo,
  PersistedThread,
  SessionUpdate,
  SessionUpdateEvent,
  PermissionRequestEvent,
  PermissionResponse,
  PermissionResolvedEvent,
  WorktreeHookProgressEvent,
  HookStep,
  Message,
  ContentBlock,
  InteractionMode,
  ImageContent
} from '@shared/types/session'
import { useWorkspaceStore } from './workspace-store'
import { useProjectStore } from './project-store'
import { useAgentStore } from './agent-store'
import { useAcpFeaturesStore } from './acp-features-store'

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

export interface ComposerDraft {
  text: string
  attachments: ImageContent[]
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
  composerDrafts: Record<string, ComposerDraft>

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
  setActiveDraft: (draftId: string | null) => void
  getComposerDraft: (threadId: string) => ComposerDraft
  setComposerDraft: (threadId: string, draft: ComposerDraft) => void
  clearComposerDraft: (threadId: string) => void
  sendPrompt: (content: ContentBlock[], mode?: InteractionMode, sessionId?: string) => Promise<void>
  cancelPrompt: () => Promise<void>
  handleSessionUpdate: (event: SessionUpdateEvent) => void
  handlePermissionRequest: (event: PermissionRequestEvent) => void
  handlePermissionResolved: (event: PermissionResolvedEvent) => void
  handleHookProgress: (event: WorktreeHookProgressEvent) => void
  respondToPermission: (requestId: string, optionId: string) => void

  // Persistence actions
  loadPersistedSessions: () => Promise<void>
  deleteSession: (sessionId: string, cleanupWorktree: boolean) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  renameWorktreeBranch: (sessionId: string, newBranch: string) => Promise<void>
  generateTitle: (sessionId: string) => Promise<string | null>
  forkSession: (sessionId: string, title?: string) => Promise<SessionInfo>
  removeSessionsByWorkspace: (workspaceId: string) => void

  // Draft thread actions
  startDraftThread: (workspaceId: string, workspacePath: string) => void
  updateDraftThread: (
    updates: Partial<Pick<DraftThread, 'agentId' | 'modelId' | 'interactionMode' | 'useWorktree' | 'workspaceId' | 'workspacePath'>>
  ) => void
  discardDraftThread: () => void
  commitDraftThread: (promptContent?: ContentBlock[]) => Promise<void>
  retryInitialization: (sessionId: string) => void

  // Helpers
  getActiveSession: () => SessionInfo | undefined
  getSessionsByWorkspace: (workspaceId: string) => SessionInfo[]
}

/** Guard to prevent duplicate reconnect attempts for the same session. */
const reconnectingIds = new Set<string>()
const promptQueueBySession = new Map<string, Array<{ content: ContentBlock[]; mode?: InteractionMode }>>()
const processingPromptSessions = new Set<string>()
const autoTitleRequestedSessionIds = new Set<string>()

function getPendingPromptText(content?: ContentBlock[]): string | undefined {
  if (!content || content.length === 0) return undefined
  const firstTextBlock = content.find(
    (block) => block.type === 'text' && block.text.trim().length > 0
  )
  return firstTextBlock?.type === 'text' ? firstTextBlock.text : undefined
}

function sanitizeSessionErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method 'session:[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

function enqueuePrompt(sessionId: string, item: { content: ContentBlock[]; mode?: InteractionMode }): void {
  const queue = promptQueueBySession.get(sessionId) ?? []
  queue.push(item)
  promptQueueBySession.set(sessionId, queue)
}

async function processPromptQueue(set: SetFn, get: GetFn, sessionId: string): Promise<void> {
  if (processingPromptSessions.has(sessionId)) {
    return
  }

  processingPromptSessions.add(sessionId)

  try {
    while ((promptQueueBySession.get(sessionId)?.length ?? 0) > 0) {
      const next = promptQueueBySession.get(sessionId)?.shift()
      if (!next) continue

      const currentSession = get().sessions.find((s) => s.sessionId === sessionId)
      const effectiveMode = next.mode ?? currentSession?.interactionMode

      try {
        await window.api.invoke('session:prompt', {
          sessionId,
          content: next.content,
          mode: effectiveMode
        })

        const hasPendingItems = (promptQueueBySession.get(sessionId)?.length ?? 0) > 0
        // Prompt completed successfully. Treat this as a hard turn boundary:
        // if an agent failed to emit terminal tool updates, close remaining open calls.
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.sessionId !== sessionId) return s
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
      } catch (error) {
        const errorMessage = (error as Error).message || 'Prompt failed'
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.sessionId === sessionId
              ? { ...s, status: 'error' as const, lastError: errorMessage }
              : s
          )
        }))
      }
    }
  } finally {
    processingPromptSessions.delete(sessionId)
    promptQueueBySession.delete(sessionId)
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  pendingPermissions: [],
  hookProgress: {},
  deletingSessionIds: new Set<string>(),
  draftThread: null,
  activeDraftId: null,
  composerDrafts: {},

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
        const nextComposerDrafts = { ...state.composerDrafts }
        delete nextComposerDrafts[sessionId]
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
          composerDrafts: nextComposerDrafts,
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

  renameWorktreeBranch: async (sessionId, newBranch) => {
    try {
      const result = await window.api.invoke('session:rename-branch', { sessionId, newBranch })
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === sessionId ? { ...s, worktreeBranch: result } : s
        )
      }))
    } catch (error) {
      console.error('Failed to rename worktree branch:', error)
      throw error
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
      // Replace placeholder with actual session and preserve composer draft input.
      set((state) => {
        const nextComposerDrafts = { ...state.composerDrafts }
        if (nextComposerDrafts[placeholderId]) {
          nextComposerDrafts[session.sessionId] = nextComposerDrafts[placeholderId]
          delete nextComposerDrafts[placeholderId]
        }

        return {
          sessions: state.sessions.map((s) =>
            s.sessionId === placeholderId ? session : s
          ),
          activeSessionId:
            state.activeSessionId === placeholderId ? session.sessionId : state.activeSessionId,
          composerDrafts: nextComposerDrafts
        }
      })
      return session
    } catch (error) {
      // Remove placeholder on failure
      set((state) => {
        const nextComposerDrafts = { ...state.composerDrafts }
        delete nextComposerDrafts[placeholderId]

        return {
          sessions: state.sessions.filter((s) => s.sessionId !== placeholderId),
          activeSessionId: state.activeSessionId === placeholderId ? null : state.activeSessionId,
          composerDrafts: nextComposerDrafts
        }
      })
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

  removeSessionsByWorkspace: (workspaceId) => {
    set((state) => {
      const removedSessionIds = new Set(
        state.sessions
          .filter((session) => session.workspaceId === workspaceId)
          .map((session) => session.sessionId)
      )

      if (removedSessionIds.size === 0) {
        return state
      }

      const nextComposerDrafts = { ...state.composerDrafts }
      for (const sessionId of removedSessionIds) {
        delete nextComposerDrafts[sessionId]
      }

      return {
        sessions: state.sessions.filter((session) => session.workspaceId !== workspaceId),
        activeSessionId:
          state.activeSessionId && removedSessionIds.has(state.activeSessionId)
            ? null
            : state.activeSessionId,
        composerDrafts: nextComposerDrafts
      }
    })
  },

  setActiveDraft: (draftId) => {
    set({ activeDraftId: draftId, activeSessionId: null })
  },

  getComposerDraft: (threadId) => {
    const draft = get().composerDrafts[threadId]
    return draft ?? { text: '', attachments: [] }
  },

  setComposerDraft: (threadId, draft) => {
    set((state) => ({
      composerDrafts: {
        ...state.composerDrafts,
        [threadId]: draft
      }
    }))
  },

  clearComposerDraft: (threadId) => {
    set((state) => {
      if (!state.composerDrafts[threadId]) {
        return state
      }
      const nextComposerDrafts = { ...state.composerDrafts }
      delete nextComposerDrafts[threadId]
      return { composerDrafts: nextComposerDrafts }
    })
  },

  sendPrompt: async (content, mode, sessionId) => {
    const targetSessionId = sessionId ?? get().activeSessionId
    if (!targetSessionId) return

    const targetSession = get().sessions.find((s) => s.sessionId === targetSessionId)
    if (!targetSession) return

    // Optimistically add user message
    const userMessage: Message = {
      id: uuid(),
      role: 'user',
      content: content,
      timestamp: new Date().toISOString()
    }

    if (targetSession.status === 'initializing' || targetSession.status === 'creating') {
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.sessionId !== targetSessionId) return s
          const nextPendingPromptQueue = [...(s.pendingPromptQueue ?? []), { content, mode }]
          return {
            ...s,
            lastError: undefined,
            messages: [...s.messages, userMessage],
            pendingPromptQueue: nextPendingPromptQueue,
            pendingPromptContent: nextPendingPromptQueue[0]?.content,
            pendingPrompt: getPendingPromptText(nextPendingPromptQueue[0]?.content)
          }
        })
      }))
      return
    }

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === targetSessionId
          ? { ...s, status: 'prompting' as const, lastError: undefined, messages: [...s.messages, userMessage] }
          : s
      )
    }))

    enqueuePrompt(targetSessionId, { content, mode })
    await processPromptQueue(set, get, targetSessionId)
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

      // Trigger title generation as soon as the first agent text arrives.
      if (update.type === 'text_chunk' && !autoTitleRequestedSessionIds.has(sessionId)) {
        const session = get().sessions.find((s) => s.sessionId === sessionId)
        if (session && shouldAutoGenerateTitle(session)) {
          autoTitleRequestedSessionIds.add(sessionId)
          window.api.invoke('session:generate-title', { sessionId }).catch(() => {
            autoTitleRequestedSessionIds.delete(sessionId)
          })
        }
      }
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

  handlePermissionResolved: (event) => {
    try {
      if (!event || !event.requestId) return
      set((state) => ({
        pendingPermissions: state.pendingPermissions.filter((p) => p.requestId !== event.requestId)
      }))
    } catch (err) {
      console.error('[session-store] Error handling permission resolution:', err)
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
    set((state) => {
      const draftId = state.draftThread?.id
      if (!draftId) {
        return { draftThread: null, activeDraftId: null }
      }
      const nextComposerDrafts = { ...state.composerDrafts }
      delete nextComposerDrafts[draftId]
      return {
        draftThread: null,
        activeDraftId: null,
        composerDrafts: nextComposerDrafts
      }
    })
  },

  commitDraftThread: async (promptContent?: ContentBlock[]) => {
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

    const pendingPromptText = getPendingPromptText(promptContent)
    const pendingPromptQueue = promptContent?.length ? [{ content: promptContent }] : undefined
    const initialMessages: Message[] = promptContent?.length
      ? [{
          id: uuid(),
          role: 'user',
          content: promptContent,
          timestamp: new Date().toISOString()
        }]
      : []

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
      messages: initialMessages,
      interactionMode: draftThread.interactionMode || undefined,
      useWorktree: draftThread.useWorktree,
      workspaceId: draftThread.workspaceId,
      pendingPrompt: pendingPromptText,
      pendingPromptContent: promptContent,
      pendingPromptQueue,
      initProgress: initSteps
    }

    // Clear draft and show placeholder — user sees the thread immediately
    set((state) => {
      const nextComposerDrafts = { ...state.composerDrafts }
      delete nextComposerDrafts[draftThread.id]
      return {
        draftThread: null,
        activeDraftId: null,
        sessions: [...state.sessions, placeholder],
        activeSessionId: placeholderId,
        composerDrafts: nextComposerDrafts
      }
    })

    // Run the initialization pipeline in the background
    runInitPipeline(set, get, placeholderId, {
      agentId,
      modelId: draftThread.modelId,
      interactionMode: draftThread.interactionMode || undefined,
      workspacePath: draftThread.workspacePath,
      useWorktree: draftThread.useWorktree,
      workspaceId: draftThread.workspaceId,
      promptContent,
      existingConnection: existingConnection || null
    })
  },

  retryInitialization: (sessionId: string) => {
    const session = get().sessions.find((s) => s.sessionId === sessionId)
    if (!session || (!session.pendingPromptQueue?.length && !session.pendingPrompt && !session.pendingPromptContent?.length)) return

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
      interactionMode: session.interactionMode,
      workspacePath: session.workingDir,
      useWorktree: session.useWorktree,
      workspaceId: session.workspaceId,
      promptContent: session.pendingPromptQueue?.[0]?.content
        ?? session.pendingPromptContent
        ?? (session.pendingPrompt ? [{ type: 'text', text: session.pendingPrompt }] : undefined),
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
  promptContent?: ContentBlock[]
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
  const { agentId, modelId, workspacePath, useWorktree, workspaceId, promptContent, existingConnection } = params
  const agentStore = useAgentStore.getState()
  const queuedPrompts = () =>
    get().sessions.find((s) => s.sessionId === placeholderId)?.pendingPromptQueue
    ?? (promptContent?.length ? [{ content: promptContent }] : [])

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

    // Persist connection on the placeholder so auth prompts can render on init errors.
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === placeholderId
          ? { ...s, connectionId: connection.connectionId }
          : s
      )
    }))

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

    const pendingQueue = queuedPrompts()
    const pendingPromptText = getPendingPromptText(pendingQueue[0]?.content)

    // Replace placeholder with real session and preserve composer draft input.
    set((state) => {
      const nextComposerDrafts = { ...state.composerDrafts }
      if (nextComposerDrafts[placeholderId]) {
        nextComposerDrafts[session.sessionId] = nextComposerDrafts[placeholderId]
        delete nextComposerDrafts[placeholderId]
      }

      return {
        sessions: state.sessions.map((s) =>
          s.sessionId === placeholderId
            ? {
                ...session,
                // Preserve optimistic user messages entered while initializing.
                messages: s.messages,
                pendingPromptQueue: pendingQueue,
                pendingPromptContent: pendingQueue[0]?.content,
                pendingPrompt: pendingPromptText
              }
            : s
        ),
        activeSessionId:
          state.activeSessionId === placeholderId ? session.sessionId : state.activeSessionId,
        composerDrafts: nextComposerDrafts
      }
    })
    if (params.interactionMode) {
      useAcpFeaturesStore.getState().applyUpdate(session.sessionId, {
        type: 'current_mode_update',
        modeId: params.interactionMode
      })
    }

    // Flush prompts queued during initialization, preserving submit order.
    if (pendingQueue.length > 0) {
      for (const queued of pendingQueue) {
        enqueuePrompt(session.sessionId, queued)
      }

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === session.sessionId
            ? {
                ...s,
                pendingPromptQueue: undefined,
                pendingPromptContent: undefined,
                pendingPrompt: undefined,
                status: 'prompting' as const
              }
            : s
        )
      }))

      await processPromptQueue(set, get, session.sessionId)
    } else {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === session.sessionId
            ? { ...s, status: 'active' as const, pendingPromptQueue: undefined, pendingPromptContent: undefined, pendingPrompt: undefined }
            : s
        )
      }))
    }
  } catch (error) {
    const errorMessage = sanitizeSessionErrorMessage((error as Error).message || 'Initialization failed')

    // Mark the running step as failed and set error status
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.sessionId !== placeholderId) return s
        const updatedSteps = (s.initProgress || []).map((step) =>
          step.status === 'running'
            ? { ...step, status: 'failed' as const, detail: errorMessage }
            : step
        )
        return {
          ...s,
          status: 'error' as const,
          initProgress: updatedSteps,
          initError: errorMessage
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
      const hasOpenStreamingAgent = normalizedSession.messages.some(
        (m) => m.role === 'agent' && m.isStreaming
      )
      if (update.messageId === 'current' && hasOpenStreamingAgent) {
        // Some agents emit duplicate/late message_start("current"). Reuse the active bubble.
        return normalizedSession
      }
      const hasExplicitMessage = update.messageId !== 'current' && normalizedSession.messages.some(
        (m) => m.id === update.messageId
      )
      if (hasExplicitMessage) {
        return normalizedSession
      }
      const newMsg: Message = {
        id: update.messageId === 'current' ? uuid() : update.messageId,
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
      return { ...session, interactionMode: update.modeId }

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

/**
 * Immutably replace (or auto-create) the target agent message in session.messages.
 * `transform` receives the existing message and must return a *new* object.
 */
function replaceAgentMessage(
  session: SessionInfo,
  messageId: string,
  transform: (msg: Message) => Message
): SessionInfo {
  // First, always prefer an exact message id match anywhere in the thread.
  // This prevents stream chunks from being re-routed when the user sends
  // another message before the prior response finishes.
  let targetIdx = -1
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].id === messageId) {
      targetIdx = i
      break
    }
  }

  // Fall back to the latest streaming agent message.
  if (targetIdx < 0) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
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

  // No matching message — create a new one at the end.
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

function shouldAutoGenerateTitle(session: SessionInfo): boolean {
  const isDefaultTitle =
    session.title === 'New Thread' || /^Session [a-f0-9]{8}$/.test(session.title)
  if (!isDefaultTitle) return false

  const userMessages = session.messages.filter((m) => m.role === 'user')
  if (userMessages.length !== 1) return false

  return session.messages.some(
    (m) => m.role === 'agent' && m.content.some((block) => block.type === 'text' && block.text.trim().length > 0)
  )
}
