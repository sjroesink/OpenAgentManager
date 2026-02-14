import { v4 as uuid } from 'uuid'
import type { SessionInfo, CreateSessionRequest, PermissionResponse, InteractionMode } from '@shared/types/session'
import { agentManager } from './agent-manager'
import { gitService } from './git-service'
import { threadStore } from './thread-store'
import { logger } from '../util/logger'

/**
 * SessionManager orchestrates sessions across agent connections.
 * Each session maps to one ACP session on one agent connection.
 */
export class SessionManagerService {
  private sessions = new Map<string, SessionInfo>()

  async createSession(request: CreateSessionRequest): Promise<SessionInfo> {
    const client = agentManager.getClient(request.connectionId)
    if (!client) {
      throw new Error(`Agent connection not found: ${request.connectionId}`)
    }

    let workingDir = request.workingDir
    let worktreePath: string | undefined
    let worktreeBranch: string | undefined
    const sessionLocalId = uuid().slice(0, 8)

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

    // Create ACP session
    const acpSessionId = await client.newSession(workingDir)

    const session: SessionInfo = {
      sessionId: acpSessionId,
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

    this.sessions.set(acpSessionId, session)
    threadStore.save(session)
    logger.info(`Session created: ${acpSessionId} on agent ${client.agentName}`)

    return session
  }

  async prompt(sessionId: string, text: string, mode?: InteractionMode): Promise<{ stopReason: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const client = agentManager.getClient(session.connectionId)
    if (!client) throw new Error(`Agent connection lost for session: ${sessionId}`)

    // Update status
    session.status = 'prompting'

    // Add user message
    session.messages.push({
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: new Date().toISOString()
    })

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
    // Find the connection for this permission request and forward
    for (const client of Array.from(this.sessions.values())) {
      const acpClient = agentManager.getClient(client.connectionId)
      if (acpClient) {
        acpClient.resolvePermission(response)
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

    // Clean up worktree if requested
    if (cleanupWorktree && thread.worktreePath && thread.useWorktree) {
      try {
        // For worktree removal we need the original project path (workspace path, not the worktree itself)
        const workspaces = (await import('./workspace-service')).workspaceService.list()
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
