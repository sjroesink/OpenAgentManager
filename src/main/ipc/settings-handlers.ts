import { ipcMain } from 'electron'
import { settingsService } from '../services/settings-service'
import { refreshAutoUpdaterSettings } from '../services/auto-updater'
import type { AppSettings } from '@shared/types/settings'

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return settingsService.get()
  })

  ipcMain.handle('settings:set', async (_event, partial: Partial<AppSettings>) => {
    settingsService.set(partial)
    // If general settings changed, refresh auto-updater config
    if (partial.general) {
      refreshAutoUpdaterSettings()
    }
  })

  ipcMain.handle(
    'settings:set-agent',
    async (
      _event,
      { agentId, settings }: { agentId: string; settings: Record<string, unknown> }
    ) => {
      settingsService.setAgentSettings(agentId, settings)
    }
  )
}
