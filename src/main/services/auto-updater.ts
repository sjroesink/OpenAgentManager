import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'
import { logger } from '../util/logger'
import { settingsService } from './settings-service'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
const STARTUP_DELAY_MS = 5_000

let checkInterval: ReturnType<typeof setInterval> | null = null

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

function sendToRenderer(channel: string, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

export function initAutoUpdater(): void {
  // Configure based on user settings
  const settings = settingsService.get()
  autoUpdater.autoDownload = settings.general.autoUpdate === true
  autoUpdater.autoInstallOnAppQuit = true

  // Disable auto-run of install on download — let the user choose (unless autoUpdate is on)
  autoUpdater.autoRunAppAfterInstall = true

  // --- Event handlers ---

  autoUpdater.on('checking-for-update', () => {
    logger.info('Auto-updater: checking for update...')
  })

  autoUpdater.on('update-available', (info) => {
    logger.info(`Auto-updater: update available — v${info.version}`)
    sendToRenderer('updater:update-available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    })
  })

  autoUpdater.on('update-not-available', () => {
    logger.info('Auto-updater: no update available')
    sendToRenderer('updater:update-not-available', {})
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('updater:download-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`Auto-updater: update downloaded — v${info.version}`)
    sendToRenderer('updater:update-downloaded', { version: info.version })

    // If auto-update is enabled, install immediately
    const currentSettings = settingsService.get()
    if (currentSettings.general.autoUpdate) {
      logger.info('Auto-updater: auto-installing update...')
      autoUpdater.quitAndInstall(false, true)
    }
  })

  autoUpdater.on('error', (err) => {
    logger.error('Auto-updater error:', err.message)
    sendToRenderer('updater:error', { message: err.message })
  })

  // --- IPC handlers ---

  ipcMain.handle('updater:check', () => {
    logger.info('Auto-updater: manual check triggered')
    autoUpdater.checkForUpdates().catch((err) => {
      logger.error('Auto-updater: check failed', err)
    })
  })

  ipcMain.handle('updater:download', () => {
    logger.info('Auto-updater: manual download triggered')
    autoUpdater.downloadUpdate().catch((err) => {
      logger.error('Auto-updater: download failed', err)
    })
  })

  ipcMain.handle('updater:install', () => {
    logger.info('Auto-updater: install triggered, quitting and installing...')
    autoUpdater.quitAndInstall(false, true)
  })

  // --- Scheduled checks ---

  // Check after a startup delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.error('Auto-updater: startup check failed', err)
    })
  }, STARTUP_DELAY_MS)

  // Check periodically
  checkInterval = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.error('Auto-updater: periodic check failed', err)
    })
  }, CHECK_INTERVAL_MS)

  logger.info('Auto-updater initialized')
}

/**
 * Call when the auto-update setting changes at runtime so autoDownload
 * reflects the new value without requiring an app restart.
 */
export function refreshAutoUpdaterSettings(): void {
  const settings = settingsService.get()
  autoUpdater.autoDownload = settings.general.autoUpdate === true
  logger.info(`Auto-updater: autoDownload set to ${autoUpdater.autoDownload}`)
}

export function stopAutoUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
