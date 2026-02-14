import { ipcMain } from 'electron'
import { sessionManager } from '../services/session-manager'
import { threadStore } from '../services/thread-store'
import { workspaceService } from '../services/workspace-service'
import type { CreateSessionRequest, PermissionResponse, InteractionMode } from '@shared/types/session'

export function registerSessionHandlers(): void {
  ipcMain.handle('session:create', async (_event, request: CreateSessionRequest) => {
    return sessionManager.createSession(request)
  })

  ipcMain.handle(
    'session:prompt',
    async (_event, { sessionId, text, mode }: { sessionId: string; text: string; mode?: InteractionMode }) => {
      return sessionManager.prompt(sessionId, text, mode)
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
    'session:set-config-option',
    async (_event, { sessionId, configId, value }: { sessionId: string; configId: string; value: string }) => {
      return sessionManager.setConfigOption(sessionId, configId, value)
    }
  )

  ipcMain.handle(
    'session:generate-title',
    async (_event, { sessionId }: { sessionId: string }) => {
      return sessionManager.generateTitle(sessionId)
    }
  )
}
