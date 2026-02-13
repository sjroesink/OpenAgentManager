import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { registerAllIpcHandlers } from './ipc'
import { agentManager } from './services/agent-manager'
import { terminalService } from './services/terminal-service'
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

  // Create the main window
  const mainWindow = createMainWindow()

  // Pass window reference to services
  agentManager.setMainWindow(mainWindow)
  terminalService.setMainWindow(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = createMainWindow()
      agentManager.setMainWindow(window)
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
