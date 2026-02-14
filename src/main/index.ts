import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { registerAllIpcHandlers } from './ipc'
import { agentManager } from './services/agent-manager'
import { sessionManager } from './services/session-manager'
import { terminalService } from './services/terminal-service'
import { threadStore } from './services/thread-store'
import { folderThreadStore } from './services/folder-thread-store'
import { workspaceService } from './services/workspace-service'
import { logger } from './util/logger'

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
}

app.whenReady().then(() => {
  logger.info('AgentManager starting...')

  // Set app user model id for Windows
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.agentmanager')
  }

  // Register IPC handlers
  registerAllIpcHandlers()

  // Migrate legacy threads from electron-store to .agent/ folders (one-time)
  if (!threadStore.isMigrationComplete()) {
    const legacyThreads = threadStore.loadAll()
    if (legacyThreads.length > 0) {
      const result = folderThreadStore.migrateFromLegacy(legacyThreads, (wsId) =>
        workspaceService.get(wsId)?.path
      )
      logger.info(
        `Legacy migration: ${result.migrated} migrated, ${result.skipped} skipped, ${result.failed} failed`
      )
    }
    threadStore.setMigrationComplete()
  }

  // Rebuild thread cache from .agent/ folders across all workspaces
  const workspaces = workspaceService.list().map((w) => ({ path: w.path, id: w.id }))
  threadStore.rebuildCacheFromFolders(workspaces)

  // Create the main window
  const mainWindow = createMainWindow()

  // Pass window reference to services
  agentManager.setMainWindow(mainWindow)
  sessionManager.setMainWindow(mainWindow)
  terminalService.setMainWindow(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = createMainWindow()
      agentManager.setMainWindow(window)
      sessionManager.setMainWindow(window)
      terminalService.setMainWindow(window)
    }
  })

  logger.info('AgentManager ready')
})

app.on('window-all-closed', () => {
  // Clean up terminals
  terminalService.killAll()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  terminalService.killAll()
})
