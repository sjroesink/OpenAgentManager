import { ipcMain } from 'electron'
import { sessionManager } from '../services/session-manager'
import type { CreateSessionRequest, PermissionResponse } from '@shared/types/session'

export function registerSessionHandlers(): void {
  ipcMain.handle('session:create', async (_event, request: CreateSessionRequest) => {
    return sessionManager.createSession(request)
  })

  ipcMain.handle(
    'session:prompt',
    async (_event, { sessionId, text }: { sessionId: string; text: string }) => {
      return sessionManager.prompt(sessionId, text)
    }
  )

  ipcMain.handle('session:cancel', async (_event, { sessionId }: { sessionId: string }) => {
    await sessionManager.cancel(sessionId)
  })

  ipcMain.handle('session:list', () => {
    return sessionManager.listSessions()
  })

  ipcMain.handle('session:permission-response', async (_event, response: PermissionResponse) => {
    sessionManager.resolvePermission(response)
  })
}
