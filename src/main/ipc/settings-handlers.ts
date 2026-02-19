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

  // ============================
  // Skills handlers
  // ============================

  ipcMain.handle('skills:list', () => {
    return settingsService.getSkills()
  })

  ipcMain.handle(
    'skills:create',
    (
      _event,
      data: { name: string; description: string; prompt: string; agentId?: string }
    ) => {
      return settingsService.createSkill(data)
    }
  )

  ipcMain.handle(
    'skills:update',
    (
      _event,
      { id, ...updates }: { id: string; name?: string; description?: string; prompt?: string; agentId?: string }
    ) => {
      return settingsService.updateSkill(id, updates)
    }
  )

  ipcMain.handle('skills:delete', (_event, { id }: { id: string }) => {
    settingsService.deleteSkill(id)
  })
}
