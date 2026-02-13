import { BrowserWindow } from 'electron'
import { v4 as uuid } from 'uuid'
import { logger } from '../util/logger'

// node-pty types - imported dynamically since it's a native module
type IPty = {
  pid: number
  cols: number
  rows: number
  onData: (callback: (data: string) => void) => { dispose: () => void }
  onExit: (callback: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void }
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
}

interface TerminalInstance {
  id: string
  pty: IPty
  sessionId: string
  disposables: Array<{ dispose: () => void }>
}

export class TerminalService {
  private terminals = new Map<string, TerminalInstance>()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Create a new terminal instance
   */
  create(cwd: string, sessionId: string): string {
    const terminalId = uuid()

    try {
      // Dynamic import of node-pty
      const pty = require('node-pty')

      const shell =
        process.platform === 'win32'
          ? 'powershell.exe'
          : process.env.SHELL || '/bin/bash'

      const ptyProcess: IPty = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: process.env as Record<string, string>
      })

      const disposables: Array<{ dispose: () => void }> = []

      // Forward terminal output to renderer
      disposables.push(
        ptyProcess.onData((data: string) => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('terminal:data', {
              terminalId,
              data
            })
          }
        })
      )

      // Handle exit
      disposables.push(
        ptyProcess.onExit(({ exitCode }) => {
          logger.info(`Terminal ${terminalId} exited with code ${exitCode}`)
          this.terminals.delete(terminalId)
        })
      )

      this.terminals.set(terminalId, {
        id: terminalId,
        pty: ptyProcess,
        sessionId,
        disposables
      })

      logger.info(`Terminal created: ${terminalId} (pid: ${ptyProcess.pid})`)
      return terminalId
    } catch (error) {
      logger.error('Failed to create terminal (node-pty may not be available):', error)
      throw new Error('Terminal creation failed. node-pty may not be installed correctly.')
    }
  }

  /**
   * Write data to terminal
   */
  write(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      terminal.pty.write(data)
    }
  }

  /**
   * Resize terminal
   */
  resize(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      terminal.pty.resize(cols, rows)
    }
  }

  /**
   * Kill terminal
   */
  kill(terminalId: string): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      for (const d of terminal.disposables) {
        d.dispose()
      }
      terminal.pty.kill()
      this.terminals.delete(terminalId)
      logger.info(`Terminal killed: ${terminalId}`)
    }
  }

  /**
   * Kill all terminals for a session
   */
  killBySession(sessionId: string): void {
    for (const [id, terminal] of this.terminals) {
      if (terminal.sessionId === sessionId) {
        this.kill(id)
      }
    }
  }

  /**
   * Kill all terminals
   */
  killAll(): void {
    for (const id of Array.from(this.terminals.keys())) {
      this.kill(id)
    }
  }
}

export const terminalService = new TerminalService()
