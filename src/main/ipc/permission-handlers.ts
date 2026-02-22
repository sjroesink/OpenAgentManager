import { ipcMain } from 'electron'
import { permissionRuleService } from '../services/permission-rule-service'
import type { PermissionRule } from '@shared/types/session'

export function registerPermissionHandlers(): void {
  ipcMain.handle(
    'permission:save-rule',
    async (_event, input: Omit<PermissionRule, 'id' | 'createdAt'>) => {
      return permissionRuleService.addRule(input)
    }
  )

  ipcMain.handle(
    'permission:list-rules',
    async (_event, { workspaceId }: { workspaceId?: string }) => {
      return permissionRuleService.listRules(workspaceId)
    }
  )

  ipcMain.handle(
    'permission:remove-rule',
    async (_event, { ruleId }: { ruleId: string }) => {
      permissionRuleService.removeRule(ruleId)
    }
  )
}
