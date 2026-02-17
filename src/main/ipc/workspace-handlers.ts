import { ipcMain, dialog, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { workspaceService } from '../services/workspace-service'
import { logger } from '../util/logger'
import { worktreeHookService } from '../services/worktree-hook-service'
import type { WorkspaceInfo } from '@shared/types/workspace'
import type { AgentProjectConfig } from '@shared/types/thread-format'

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
    return { success: true }
  })

  ipcMain.handle(
    'workspace:update',
    async (
      _event,
      {
        id,
        updates
      }: {
        id: string
        updates: Partial<
          Pick<WorkspaceInfo, 'name' | 'lastAccessedAt' | 'defaultAgentId' | 'defaultModelId' | 'defaultInteractionMode' | 'defaultUseWorktree'>
        >
      }
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
    // execFile does NOT spawn a shell, so path cannot break out
    execFile('code', [path], (err) => {
      if (err) logger.warn('Failed to open VS Code:', err.message)
    })
  })

  ipcMain.handle(
    'workspace:get-config',
    async (_event, { workspacePath }: { workspacePath: string }) => {
      return worktreeHookService.readConfig(workspacePath)
    }
  )

  ipcMain.handle(
    'workspace:set-config',
    async (
      _event,
      { workspacePath, config }: { workspacePath: string; config: AgentProjectConfig }
    ) => {
      worktreeHookService.writeConfig(workspacePath, config)
      return { success: true }
    }
  )
}
