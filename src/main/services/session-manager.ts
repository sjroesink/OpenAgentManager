import { v4 as uuid } from 'uuid'
import type { BrowserWindow } from 'electron'
import type { SessionInfo, CreateSessionRequest, PermissionResponse, PermissionRequestEvent, InteractionMode, SessionUpdateEvent, WorktreeHookProgressEvent, HookStep, ContentBlock } from '@shared/types/session'
import { applyUpdateToMessages } from '@shared/util/session-util'
import { agentManager } from './agent-manager'
import { gitService } from './git-service'
import { worktreeHookService } from './worktree-hook-service'
import { threadStore } from './thread-store'
import { workspaceService } from './workspace-service'
import { settingsService } from './settings-service'
import { logger } from '../util/logger'

/**
 * SessionManager orchestrates sessions across agent connections.
 * Each session maps to one ACP session on one agent connection.
 */
export class SessionManagerService {
  private sessions = new Map<string, SessionInfo>()
  private monitoredConnections = new Set<string>()
  private mainWindow: BrowserWindow | null = null
  private pendingPermissions = new Map<string, PermissionRequestEvent>()

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** Read enabled MCP servers from settings, mapped to the format ACP session/new expects */
  private getEnabledMcpServers(): Record<string, unknown>[] {
    const servers = settingsService.get().mcp.servers
    return servers
      .filter((s) => s.enabled)
      .map((s) => ({
        name: s.name,
        transport: s.transport,
        ...(s.command ? { command: s.command } : {}),
        ...(s.args?.length ? { args: s.args } : {}),
        ...(s.url ? { url: s.url } : {}),
        ...(s.env && Object.keys(s.env).length ? { env: s.env } : {})
      }))
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
      client.on('permission-request', (event: PermissionRequestEvent) => {
        this.trackPermission(event)
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
    const mcpServers = this.getEnabledMcpServers()
    await client.newSession(workingDir, mcpServers, sessionId)

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
        this.prompt(sessionId, [{ type: 'text', text: promptText }]).then(() => {
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

  async forkSession(sourceSessionId: string, title?: string): Promise<SessionInfo> {
    // Find the source session
    let source = this.sessions.get(sourceSessionId)

    // Recovery: if not in memory, try to load from store
    if (!source) {
      const persisted = threadStore.loadAll().find((t) => t.sessionId === sourceSessionId)
      if (persisted) {
        source = {
          ...persisted,
          connectionId: '',
          status: 'idle'
        }
        this.sessions.set(sourceSessionId, source)
        logger.info(`Session rehydrated from store for fork: ${sourceSessionId}`)
      }
    }

    if (!source) throw new Error(`Source session not found: ${sourceSessionId}`)

    // Recovery: if connection lost, re-launch agent
    let client = agentManager.getClient(source.connectionId)
    if (!client) {
      logger.info(`Agent connection lost for source session ${sourceSessionId}, re-launching agent ${source.agentId}...`)
      const connection = await agentManager.launch(source.agentId, source.workingDir)
      source.connectionId = connection.connectionId
      this.sessions.set(sourceSessionId, source)
      client = agentManager.getClient(source.connectionId)!
      await client.newSession(source.workingDir, this.getEnabledMcpServers(), sourceSessionId)
    }

    // Verify agent connection
    if (!client) throw new Error(`Agent connection not found: ${source.connectionId}`)

    // Check agent capability
    if (!client.supportsFork) {
      throw new Error(`Agent ${client.agentName} does not support session/fork`)
    }

    // Generate IDs
    const newSessionId = uuid()

    // Call ACP fork with our stable sessionId for mapping
    await client.forkSession(sourceSessionId, source.workingDir, [], newSessionId)

    // Build the forked SessionInfo
    const session: SessionInfo = {
      sessionId: newSessionId,
      connectionId: source.connectionId,
      agentId: source.agentId,
      agentName: source.agentName,
      title: title || `Fork of ${source.title}`,
      createdAt: new Date().toISOString(),
      worktreePath: source.worktreePath,
      worktreeBranch: source.worktreeBranch,
      workingDir: source.workingDir,
      status: 'active',
      messages: [],
      useWorktree: source.useWorktree,
      workspaceId: source.workspaceId,
      parentSessionId: sourceSessionId
    }

    this.sessions.set(newSessionId, session)
    this.ensureListener(source.connectionId)
    threadStore.save(session)
    logger.info(`Session forked: ${newSessionId} from ${sourceSessionId}`)

    return session
  }

  async prompt(sessionId: string, content: ContentBlock[], mode?: InteractionMode): Promise<{ stopReason: string }> {
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
      await client.newSession(session.workingDir, this.getEnabledMcpServers(), sessionId)
    }

    this.ensureListener(session.connectionId)

    // Update status
    session.status = 'prompting'

    // Add user message
    session.messages.push({
      id: uuid(),
      role: 'user',
      content: content,
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
      const result = await client.prompt(sessionId, content, mode)

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
      client.cancel(sessionId)
    }

    session.status = 'cancelled'
  }

  resolvePermission(response: PermissionResponse): void {
    // Remove from pending tracking
    this.pendingPermissions.delete(response.requestId)

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

  trackPermission(event: PermissionRequestEvent): void {
    this.pendingPermissions.set(event.requestId, event)
  }

  listPendingPermissions(): PermissionRequestEvent[] {
    return Array.from(this.pendingPermissions.values())
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const client = agentManager.getClient(session.connectionId)
    if (!client) throw new Error(`Agent connection not found: ${session.connectionId}`)
    await client.setMode(sessionId, modeId)
  }

  async setConfigOption(sessionId: string, configId: string, value: string): Promise<unknown> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const client = agentManager.getClient(session.connectionId)
    if (!client) throw new Error(`Agent connection not found: ${session.connectionId}`)
    return await client.setConfigOption(sessionId, configId, value)
  }

  /**
   * Auto-generate a thread title using the configured summarization agent.
   * Launches the agent, sends the conversation as context, and extracts a short title.
   */
  async generateTitle(sessionId: string): Promise<string | null> {
    const settings = settingsService.get()
    const agentId = settings.general.summarizationAgentId
    if (!agentId) {
      logger.warn('generateTitle: no summarization agent configured')
      return null
    }

    let session = this.sessions.get(sessionId)
    // Also check persisted threads if not in memory
    if (!session) {
      const persisted = threadStore.loadAll().find((t) => t.sessionId === sessionId)
      if (persisted) {
        session = {
          ...persisted,
          connectionId: '',
          agentId: '',
          status: 'idle',
          messages: persisted.messages.map((m) => ({
            ...m,
            content: m.content as ContentBlock[]
          }))
        }
        logger.info(`generateTitle: loaded session from persisted store, workingDir: ${session.workingDir}`)
      }
    }
    if (!session) {
      logger.warn(`generateTitle: session not found: ${sessionId}`)
      return null
    }

    // Build a summary of the conversation for the title prompt
    const conversationText = session.messages
      .filter((m) => m.content.length > 0)
      .map((m) => {
        const text = m.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
        return `${m.role === 'user' ? 'User' : 'Agent'}: ${text}`
      })
      .join('\n\n')

    if (!conversationText.trim()) {
      logger.warn(`generateTitle: no conversation text for session: ${sessionId}, message count: ${session.messages.length}`)
      return null
    }

    logger.info(`generateTitle: generating title for session ${sessionId} with ${session.messages.length} messages`)

    const titlePrompt = `Generate a very short title (max 6 words) for the following conversation. Reply with ONLY the title, nothing else. No quotes, no punctuation at the end.\n\n${conversationText}`

    try {
      // Find or launch the summarization agent
      const connections = agentManager.listConnections()
      let connection = connections.find(
        (c) => c.agentId === agentId && c.status === 'connected'
      )
      if (!connection) {
        connection = await agentManager.launch(agentId, session.workingDir)
      }

      const client = agentManager.getClient(connection.connectionId)
      if (!client) return null

      // Create a temporary session for the title generation
      const tempSessionId = `title-${uuid().slice(0, 8)}`
      await client.newSession(session.workingDir, this.getEnabledMcpServers(), tempSessionId)

      // Collect response text from streaming events
      let responseText = ''
      const listener = (event: SessionUpdateEvent): void => {
        if (event.sessionId !== tempSessionId) return
        if (event.update.type === 'text_chunk' && event.update.text) {
          responseText += event.update.text
        }
      }
      client.on('session-update', listener)

      try {
        await client.prompt(tempSessionId, titlePrompt)
      } finally {
        client.removeListener('session-update', listener)
      }

      // Clean up: we don't persist the temp session
      const title = responseText.trim().replace(/^["']|["']$/g, '').slice(0, 100)
      if (!title) return null

      // Apply the generated title
      threadStore.rename(sessionId, title)
      session.title = title

      // Notify the renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('session:update', {
          sessionId,
          update: { type: 'session_info_update', title }
        })
      }

      logger.info(`Auto-generated title for ${sessionId}: ${title}`)
      return title
    } catch (error) {
      logger.warn(`Failed to auto-generate title for ${sessionId}:`, error)
      return null
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

    // Orphan children: promote child sessions to root level
    for (const [, s] of this.sessions) {
      if (s.parentSessionId === sessionId) {
        s.parentSessionId = undefined
        threadStore.save(s)
      }
    }

    this.sessions.delete(sessionId)
    threadStore.remove(sessionId)
  }
}

export const sessionManager = new SessionManagerService()
