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
      terminalService.resize(terminalId, cols, rows)
    }
  )

  ipcMain.handle('terminal:kill', async (_event, { terminalId }: { terminalId: string }) => {
    terminalService.kill(terminalId)
  })
}
