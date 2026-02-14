import { ipcMain, dialog, BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { workspaceService } from '../services/workspace-service'
import type { WorkspaceInfo } from '@shared/types/workspace'

export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspace:list', () => {
    return workspaceService.list()
  })

  ipcMain.handle(
    'workspace:create',
    async (_event, { path, name }: { path: string; name?: string }) => {
      return workspaceService.create(path, name)
    }
  )

  ipcMain.handle('workspace:remove', async (_event, { id }: { id: string }) => {
    workspaceService.remove(id)
  })

  ipcMain.handle(
    'workspace:update',
    async (
      _event,
      { id, updates }: { id: string; updates: Partial<Pick<WorkspaceInfo, 'name' | 'lastAccessedAt'>> }
    ) => {
      return workspaceService.update(id, updates)
    }
  )

  ipcMain.handle('workspace:select-directory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select Workspace Directory'
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('workspace:open-in-vscode', async (_event, { path }: { path: string }) => {
    exec(`code "${path}"`)
  })
}
