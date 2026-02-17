import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { execFile } from 'child_process'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { workspaceService } from '../services/workspace-service'
import { logger } from '../util/logger'
import { worktreeHookService } from '../services/worktree-hook-service'
import type { WorkspaceInfo } from '@shared/types/workspace'
import type { AgentProjectConfig } from '@shared/types/thread-format'

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

async function getWindowsCodeExecutable(): Promise<string | null> {
  const candidates = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Microsoft VS Code', 'Code.exe') : null,
    process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Microsoft VS Code', 'Code.exe') : null
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.F_OK)
      return candidate
    } catch {
      // Candidate path not usable, continue to next.
    }
  }

  return null
}

async function openInVSCode(workspacePath: string): Promise<void> {
  const commands = process.platform === 'win32' ? ['code.cmd', 'code'] : ['code']
  const launchErrors: string[] = []

  for (const command of commands) {
    try {
      await execFileAsync(command, [workspacePath])
      return
    } catch (error) {
      launchErrors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (process.platform === 'win32') {
    const codeExe = await getWindowsCodeExecutable()
    if (codeExe) {
      try {
        await execFileAsync(codeExe, [workspacePath])
        return
      } catch (error) {
        launchErrors.push(`Code.exe: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const uriPath = workspacePath.replace(/\\/g, '/')
    try {
      await shell.openExternal(`vscode://file/${encodeURI(uriPath)}`)
      return
    } catch (error) {
      launchErrors.push(`vscode:// URI: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(`Unable to launch VS Code for "${workspacePath}". Attempts: ${launchErrors.join(' | ')}`)
}

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
    try {
      await openInVSCode(path)
    } catch (error) {
      logger.warn('Failed to open VS Code:', error instanceof Error ? error.message : error)
      throw error
    }
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
