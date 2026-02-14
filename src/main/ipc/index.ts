import { registerAgentHandlers } from './agent-handlers'
import { registerSessionHandlers } from './session-handlers'
import { registerFileHandlers } from './file-handlers'
import { registerGitHandlers } from './git-handlers'
import { registerTerminalHandlers } from './terminal-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerWorkspaceHandlers } from './workspace-handlers'
import { registerWindowHandlers } from './window-handlers'

/**
 * Register all IPC handlers.
 * Call this once from the main process entry point.
 */
export function registerAllIpcHandlers(): void {
  registerAgentHandlers()
  registerSessionHandlers()
  registerFileHandlers()
  registerGitHandlers()
  registerTerminalHandlers()
  registerSettingsHandlers()
  registerWorkspaceHandlers()
  registerWindowHandlers()
}
