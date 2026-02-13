import { ipcMain } from 'electron'
import { settingsService } from '../services/settings-service'
import type { AppSettings } from '@shared/types/settings'

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return settingsService.get()
  })

  ipcMain.handle('settings:set', async (_event, partial: Partial<AppSettings>) => {
    settingsService.set(partial)
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
