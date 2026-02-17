import { ipcMain } from 'electron'
import { sessionManager } from '../services/session-manager'
import { threadStore } from '../services/thread-store'
import { gitService } from '../services/git-service'
import { workspaceService } from '../services/workspace-service'
import type { CreateSessionRequest, PermissionResponse, InteractionMode, ContentBlock } from '@shared/types/session'

export function registerSessionHandlers(): void {
  ipcMain.handle('session:create', async (_event, request: CreateSessionRequest) => {
    return sessionManager.createSession(request)
  })

  ipcMain.handle(
    'session:prompt',
    async (_event, { sessionId, content, mode }: { sessionId: string; content: ContentBlock[]; mode?: InteractionMode }) => {
      return sessionManager.prompt(sessionId, content, mode)
    }
  )

  ipcMain.handle('session:cancel', async (_event, { sessionId }: { sessionId: string }) => {
    await sessionManager.cancel(sessionId)
  })

  ipcMain.handle('session:list', () => {
    return sessionManager.listSessions()
  })

  ipcMain.handle('session:list-persisted', () => {
    return threadStore.loadAll()
  })

  ipcMain.handle(
    'session:remove',
    async (_event, { sessionId, cleanupWorktree }: { sessionId: string; cleanupWorktree: boolean }) => {
      await sessionManager.removeSession(sessionId, cleanupWorktree)
    }
  )

  ipcMain.handle('session:permission-response', async (_event, response: PermissionResponse) => {
    sessionManager.resolvePermission(response)
  })

  ipcMain.handle(
    'session:rename',
    async (_event, { sessionId, title }: { sessionId: string; title: string }) => {
      threadStore.rename(sessionId, title)
    }
  )

  ipcMain.handle('session:rebuild-cache', () => {
    const workspaces = workspaceService.list().map((w) => ({ path: w.path, id: w.id }))
    threadStore.rebuildCacheFromFolders(workspaces)
    return { threadCount: threadStore.loadAll().length }
  })

  ipcMain.handle(
    'session:set-mode',
    async (_event, { sessionId, modeId }: { sessionId: string; modeId: string }) => {
      await sessionManager.setMode(sessionId, modeId)
    }
  )

  ipcMain.handle(
    'session:set-interaction-mode',
    async (_event, { sessionId, mode }: { sessionId: string; mode: InteractionMode }) => {
      await sessionManager.setInteractionMode(sessionId, mode)
    }
  )

  ipcMain.handle(
    'session:set-model',
    async (_event, { sessionId, modelId }: { sessionId: string; modelId: string }) => {
      await sessionManager.setModel(sessionId, modelId)
    }
  )

  ipcMain.handle(
    'session:set-config-option',
    async (_event, { sessionId, configId, value }: { sessionId: string; configId: string; value: string }) => {
      return sessionManager.setConfigOption(sessionId, configId, value)
    }
  )

  ipcMain.handle(
    'session:generate-title',
    async (_event, { sessionId }: { sessionId: string }) => {
      console.log('[session:generate-title] Received request for sessionId:', sessionId)
      const result = await sessionManager.generateTitle(sessionId)
      console.log('[session:generate-title] Result:', result)
      return result
    }
  )

  ipcMain.handle(
    'session:fork',
    async (_event, { sessionId, title }: { sessionId: string; title?: string }) => {
      const result = await sessionManager.forkSession(sessionId, title)
      console.log('[session:fork] Returning:', result)
      return result
    }
  )

  ipcMain.handle(
    'session:ensure-connected',
    async (_event, { sessionId }: { sessionId: string }) => {
      return sessionManager.ensureConnected(sessionId)
    }
  )

  ipcMain.handle(
    'session:rename-branch',
    async (_event, { sessionId, newBranch }: { sessionId: string; newBranch: string }) => {
      // Find the session's worktree path from persisted data
      const thread = threadStore.loadAll().find((t) => t.sessionId === sessionId)
      if (!thread) throw new Error(`Session not found: ${sessionId}`)
      if (!thread.worktreePath) throw new Error('Session does not have a worktree')

      // Rename the git branch
      const result = await gitService.renameBranch(thread.worktreePath, newBranch)

      // Update persisted data
      threadStore.updateWorktreeBranch(sessionId, result)

      // Update in-memory session if active
      const session = sessionManager.getSession(sessionId)
      if (session) {
        session.worktreeBranch = result
      }

      return result
    }
  )
}
