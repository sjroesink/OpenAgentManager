import { ipcMain } from 'electron'
import { isWslAvailable, getWslDistributions } from '../util/platform'

export function registerSystemHandlers(): void {
  ipcMain.handle('system:wsl-info', () => {
    const available = isWslAvailable()
    const distributions = available ? getWslDistributions() : []
    return { available, distributions }
  })
}
