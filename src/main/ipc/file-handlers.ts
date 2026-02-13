import { ipcMain, dialog, BrowserWindow } from 'electron'
import { fileService } from '../services/file-service'
import { gitService } from '../services/git-service'

export function registerFileHandlers(): void {
  ipcMain.handle(
    'file:read-tree',
    async (_event, { dirPath, depth }: { dirPath: string; depth?: number }) => {
      return fileService.readTree(dirPath, depth)
    }
  )

  ipcMain.handle('file:read', async (_event, { filePath }: { filePath: string }) => {
    return fileService.readFile(filePath)
  })

  ipcMain.handle(
    'file:get-changes',
    async (_event, { workingDir }: { workingDir: string }) => {
      return fileService.getChanges(workingDir)
    }
  )

  ipcMain.handle('project:open', async (_event, { path: projectPath }: { path: string }) => {
    const isGitRepo = await gitService.isGitRepo(projectPath)
    const gitBranch = isGitRepo ? await gitService.getBranch(projectPath) : undefined
    const name = projectPath.split(/[/\\]/).pop() || projectPath

    return {
      path: projectPath,
      name,
      isGitRepo,
      gitBranch
    }
  })

  ipcMain.handle('project:select-directory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select Project Directory'
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
