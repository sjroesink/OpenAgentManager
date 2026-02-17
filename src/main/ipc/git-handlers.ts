import { ipcMain } from 'electron'
import { gitService } from '../services/git-service'

export function registerGitHandlers(): void {
  ipcMain.handle(
    'git:status',
    async (_event, { projectPath }: { projectPath: string }) => {
      return gitService.getStatus(projectPath)
    }
  )

  ipcMain.handle(
    'git:create-worktree',
    async (
      _event,
      { basePath, sessionId, baseBranch }: { basePath: string; sessionId: string; baseBranch?: string }
    ) => {
      return gitService.createWorktree(basePath, sessionId, baseBranch)
    }
  )

  ipcMain.handle(
    'git:remove-worktree',
    async (
      _event,
      { projectPath, worktreePath }: { projectPath: string; worktreePath: string }
    ) => {
      await gitService.removeWorktree(projectPath, worktreePath)
    }
  )

  ipcMain.handle(
    'git:list-worktrees',
    async (_event, { projectPath }: { projectPath: string }) => {
      return gitService.listWorktrees(projectPath)
    }
  )

  ipcMain.handle(
    'git:commit',
    async (
      _event,
      { worktreePath, message, files }: { worktreePath: string; message: string; files: string[] }
    ) => {
      return gitService.commit(worktreePath, message, files)
    }
  )

  ipcMain.handle(
    'git:diff',
    async (_event, { worktreePath, filePath }: { worktreePath: string; filePath?: string }) => {
      return gitService.getDiff(worktreePath, filePath)
    }
  )

  ipcMain.handle(
    'git:rename-branch',
    async (_event, { worktreePath, newBranch }: { worktreePath: string; newBranch: string }) => {
      return gitService.renameBranch(worktreePath, newBranch)
    }
  )
}
