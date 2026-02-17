import { ipcMain } from 'electron'
import { terminalService } from '../services/terminal-service'

export function registerTerminalHandlers(): void {
  ipcMain.handle(
    'terminal:create',
    async (_event, { cwd, sessionId }: { cwd: string; sessionId: string }) => {
      return terminalService.create(cwd, sessionId)
    }
  )

  ipcMain.handle(
    'terminal:write',
    async (_event, { terminalId, data }: { terminalId: string; data: string }) => {
      terminalService.write(terminalId, data)
    }
  )

  ipcMain.handle(
    'terminal:resize',
    async (
      _event,
      { terminalId, cols, rows }: { terminalId: string; cols: number; rows: number }
    ) => {
      const safeCols = Math.max(1, Math.min(500, Math.floor(cols)))
      const safeRows = Math.max(1, Math.min(200, Math.floor(rows)))
      terminalService.resize(terminalId, safeCols, safeRows)
    }
  )

  ipcMain.handle('terminal:kill', async (_event, { terminalId }: { terminalId: string }) => {
    terminalService.kill(terminalId)
  })
}
