import { ipcMain } from 'electron'
import { registryService } from '../services/registry-service'
import { agentManager } from '../services/agent-manager'

export function registerAgentHandlers(): void {
  // --- Registry ---
  ipcMain.handle('registry:fetch', async () => {
    return registryService.fetch()
  })

  ipcMain.handle('registry:get-cached', () => {
    return registryService.getCached()
  })

  // --- Agent Management ---
  ipcMain.handle('agent:install', async (_event, { agentId }: { agentId: string }) => {
    return agentManager.install(agentId)
  })

  ipcMain.handle('agent:uninstall', async (_event, { agentId }: { agentId: string }) => {
    agentManager.uninstall(agentId)
  })

  ipcMain.handle('agent:list-installed', () => {
    return agentManager.listInstalled()
  })

  ipcMain.handle(
    'agent:launch',
    async (_event, { agentId, projectPath }: { agentId: string; projectPath: string }) => {
      return agentManager.launch(agentId, projectPath)
    }
  )

  ipcMain.handle('agent:terminate', async (_event, { connectionId }: { connectionId: string }) => {
    agentManager.terminate(connectionId)
  })

  ipcMain.handle(
    'agent:authenticate',
    async (
      _event,
      {
        connectionId,
        method,
        credentials
      }: { connectionId: string; method: string; credentials?: Record<string, string> }
    ) => {
      await agentManager.authenticate(connectionId, method, credentials)
    }
  )

  ipcMain.handle('agent:list-connections', () => {
    return agentManager.listConnections()
  })
}
