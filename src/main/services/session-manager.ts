import { v4 as uuid } from 'uuid'
import type { BrowserWindow } from 'electron'
import type { SessionInfo, CreateSessionRequest, PermissionResponse, InteractionMode, SessionUpdateEvent, WorktreeHookProgressEvent, HookStep } from '@shared/types/session'
import { applyUpdateToMessages } from '@shared/util/session-util'
import { agentManager } from './agent-manager'
import { gitService } from './git-service'
import { worktreeHookService } from './worktree-hook-service'
import { threadStore } from './thread-store'
import { workspaceService } from './workspace-service'
import { logger } from '../util/logger'

/**
 * SessionManager orchestrates sessions across agent connections.
 * Each session maps to one ACP session on one agent connection.
 */
export class SessionManagerService {
  private sessions = new Map<string, SessionInfo>()
  private monitoredConnections = new Set<string>()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private sendHookProgress(event: WorktreeHookProgressEvent): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('session:hook-progress', event)
    }
  }

  private ensureListener(connectionId: string): void {
    if (this.monitoredConnections.has(connectionId)) return

    const client = agentManager.getClient(connectionId)
    if (client) {
      client.on('session-update', (event: SessionUpdateEvent) => {
        const session = this.sessions.get(event.sessionId)
        if (session) {
          // Update status from session-update events
          if (event.update.type === 'status_change') {
            session.status = event.update.status
          } else if (event.update.type === 'message_complete') {
            session.status = 'active'
          } else if (event.update.type === 'error') {
            session.status = 'error'
          }
        }
      })
      this.monitoredConnections.add(connectionId)
    }
  }

  async createSession(request: CreateSessionRequest): Promise<SessionInfo> {
    const client = agentManager.getClient(request.connectionId)
    if (!client) {
      throw new Error(`Agent connection not found: ${request.connectionId}`)
    }

    let workingDir = request.workingDir
    let worktreePath: string | undefined
    let worktreeBranch: string | undefined
    let pendingInitialPrompt: string | undefined
    let lastHookSteps: HookStep[] | undefined
    const sessionLocalId = uuid().slice(0, 8)
    const sessionId = uuid()

    // Create git worktree if requested
    if (request.useWorktree) {
      try {
        const worktree = await gitService.createWorktree(
          request.workingDir,
          sessionLocalId
        )
        worktreePath = worktree.path
        worktreeBranch = worktree.branch
        workingDir = worktree.path
        logger.info(`Created worktree for session: ${worktreePath} (${worktreeBranch})`)
      } catch (error) {
        logger.warn('Failed to create worktree, using main directory:', error)
      }
    }

    // Execute worktree hooks (symlinks, commands, initial prompt)
    if (request.useWorktree && worktreePath) {
      try {
        pendingInitialPrompt = await worktreeHookService.executeHooks(
          request.workingDir,
          worktreePath,
          sessionId,
          (event) => {
            lastHookSteps = event.steps
            this.sendHookProgress(event)
          }
        )
      } catch (error) {
        logger.warn('Worktree hooks failed (non-fatal):', error)
      }
    }

    // Create ACP session with our stable sessionId for mapping
    await client.newSession(workingDir, [], sessionId)

    const session: SessionInfo = {
      sessionId,
      connectionId: request.connectionId,
      agentId: client.agentId,
      agentName: client.agentName,
      title: request.title || `Session ${sessionLocalId}`,
      createdAt: new Date().toISOString(),
      worktreePath,
      worktreeBranch,
      workingDir,
      status: 'active',
      messages: [],
      useWorktree: request.useWorktree,
      workspaceId: request.workspaceId
    }

    this.sessions.set(sessionId, session)
    this.ensureListener(request.connectionId)
    threadStore.save(session)
    logger.info(`Session created: ${sessionId} on agent ${client.agentName}`)

    // Fire-and-forget initial prompt from worktree hooks
    if (pendingInitialPrompt) {
      const promptText = pendingInitialPrompt
      const hookSteps = lastHookSteps
      setImmediate(() => {
        this.prompt(sessionId, promptText).then(() => {
          if (hookSteps) {
            const ipStep = hookSteps.find((s) => s.label === 'Initial prompt')
            if (ipStep) ipStep.status = 'completed'
            this.sendHookProgress({ sessionId, steps: hookSteps })
          }
        }).catch((err) => {
          logger.warn('Failed to send initial prompt:', err)
          if (hookSteps) {
            const ipStep = hookSteps.find((s) => s.label === 'Initial prompt')
            if (ipStep) {
              ipStep.status = 'failed'
              ipStep.detail = String(err)
            }
            this.sendHookProgress({ sessionId, steps: hookSteps })
          }
        })
      })
    }

    return session
  }

  async prompt(sessionId: string, text: string, mode?: InteractionMode): Promise<{ stopReason: string }> {
    let session = this.sessions.get(sessionId)
    
    // Recovery: if not in memory, try to load from store
    if (!session) {
      const persisted = threadStore.loadAll().find((t) => t.sessionId === sessionId)
      if (persisted) {
        session = {
          ...persisted,
          connectionId: '',
          status: 'idle'
        }
        this.sessions.set(sessionId, session)
        logger.info(`Session rehydrated from store: ${sessionId}`)
      }
    }

    if (!session) throw new Error(`Session not found: ${sessionId}`)

    let client = agentManager.getClient(session.connectionId)
    
    // Recovery: if connection lost, re-launch agent
    if (!client) {
      logger.info(`Agent connection lost for session ${sessionId}, re-launching agent ${session.agentId}...`)
      const connection = await agentManager.launch(session.agentId, session.workingDir)
      session.connectionId = connection.connectionId
      client = agentManager.getClient(session.connectionId)!
      
      // Re-create ACP session
      await client.newSession(session.workingDir, [], sessionId)
    }

    this.ensureListener(session.connectionId)

    // Update status
    session.status = 'prompting'

    // Add user message
    session.messages.push({
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: new Date().toISOString()
    })

    // Subscribe directly to session-update events for this prompt.
    // This ensures agent messages are captured in session.messages
    // before persistence.
    const promptListener = (event: SessionUpdateEvent): void => {
      if (event.sessionId === sessionId) {
        session.messages = applyUpdateToMessages(session.messages, event.update)
      }
    }
    client.on('session-update', promptListener)

    try {
      const result = await client.prompt(sessionId, text, mode)

      session.status = 'active'
      // Persist messages after prompt completes
      threadStore.updateMessages(sessionId, session.messages)
      return { stopReason: result.stopReason }
    } catch (error) {
      session.status = 'error'
      // Still persist messages on error so conversation history is saved
      threadStore.updateMessages(sessionId, session.messages)
      throw error
    } finally {
      client.removeListener('session-update', promptListener)
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const client = agentManager.getClient(session.connectionId)
    if (client) {
      await client.cancel(sessionId)
    }

    session.status = 'cancelled'
  }

  resolvePermission(response: PermissionResponse): void {
    // Forward the permission response to all active agent connections.
    // Each client will check if it has a pending resolver for this requestId.
    const connections = agentManager.listConnections()
    for (const conn of connections) {
      const client = agentManager.getClient(conn.connectionId)
      if (client) {
        client.resolvePermission(response)
      }
    }
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values())
  }

  async removeSession(sessionId: string, cleanupWorktree = false): Promise<void> {
    const session = this.sessions.get(sessionId)
    // Also check persisted threads if not in memory
    const persisted = !session ? threadStore.loadAll().find((t) => t.sessionId === sessionId) : null
    const thread = session || persisted

    if (!thread) return

    // Terminate the agent connection first so it releases file handles on the worktree
    const connectionId = session?.connectionId
    if (connectionId) {
      try {
        agentManager.terminate(connectionId)
        logger.info(`Agent connection terminated for session: ${sessionId}`)
        // Give the OS a moment to release file handles (Windows needs this)
        if (process.platform === 'win32') {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      } catch (error) {
        logger.warn('Failed to terminate agent connection:', error)
      }
    }

    // Clean up worktree if requested
    if (cleanupWorktree && thread.worktreePath && thread.useWorktree) {
      try {
        // For worktree removal we need the original project path (workspace path, not the worktree itself)
        const workspaces = workspaceService.list()
        const workspace = workspaces.find((w) => w.id === thread.workspaceId)
        if (workspace) {
          await gitService.removeWorktree(workspace.path, thread.worktreePath)
          logger.info(`Worktree removed: ${thread.worktreePath}`)
        }
      } catch (error) {
        logger.warn('Failed to clean up worktree:', error)
      }
    }

    this.sessions.delete(sessionId)
    threadStore.remove(sessionId)
  }
}

export const sessionManager = new SessionManagerService()
