import { ipcMain } from 'electron'
import { sessionManager } from '../services/session-manager'
import { threadStore } from '../services/thread-store'
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
}
