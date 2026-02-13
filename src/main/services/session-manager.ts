import { v4 as uuid } from 'uuid'
import type { SessionInfo, CreateSessionRequest, PermissionResponse } from '@shared/types/session'
import { agentManager } from './agent-manager'
import { gitService } from './git-service'
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
      useWorktree: request.useWorktree
    }

    this.sessions.set(acpSessionId, session)
    logger.info(`Session created: ${acpSessionId} on agent ${client.agentName}`)

    return session
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
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
      const result = await client.prompt(sessionId, text)

      session.status = 'active'
      return { stopReason: result.stopReason }
    } catch (error) {
      session.status = 'error'
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

  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // Clean up worktree if applicable
    if (session.worktreePath && session.useWorktree) {
      try {
        const basePath = session.workingDir === session.worktreePath
          ? session.worktreePath // Will need the original project path
          : session.workingDir
        // Note: worktree cleanup could be deferred based on settings
        logger.info(`Worktree preserved at: ${session.worktreePath}`)
      } catch (error) {
        logger.warn('Failed to clean up worktree:', error)
      }
    }

    this.sessions.delete(sessionId)
  }
}

export const sessionManager = new SessionManagerService()
