import Store from 'electron-store'
import { v4 as uuid } from 'uuid'
import type { PermissionRule } from '@shared/types/session'

interface PermissionRuleStore {
  rules: PermissionRule[]
}

const store = new Store<PermissionRuleStore>({
  name: 'permission-rules',
  defaults: { rules: [] }
})

export class PermissionRuleService {
  addRule(input: Omit<PermissionRule, 'id' | 'createdAt'>): PermissionRule {
    const rule: PermissionRule = {
      ...input,
      id: uuid(),
      createdAt: new Date().toISOString()
    }
    const rules = store.get('rules', [])
    rules.push(rule)
    store.set('rules', rules)
    return rule
  }

  removeRule(ruleId: string): void {
    const rules = store.get('rules', [])
    store.set(
      'rules',
      rules.filter((r) => r.id !== ruleId)
    )
  }

  listRules(workspaceId?: string): PermissionRule[] {
    const rules = store.get('rules', [])
    if (workspaceId) {
      return rules.filter((r) => r.workspaceId === workspaceId)
    }
    return rules
  }

  /**
   * Find a matching "always" rule for the given context.
   * Thread-scoped rules are checked first, then workspace-scoped.
   */
  findMatchingRule(
    workspaceId: string,
    threadId: string,
    matchKey: string
  ): PermissionRule | undefined {
    if (!matchKey) return undefined

    const rules = store.get('rules', [])

    // Thread-scoped rules first (more specific)
    const threadRule = rules.find(
      (r) => r.scope === 'thread' && r.threadId === threadId && r.matchKey === matchKey
    )
    if (threadRule) return threadRule

    // Workspace-scoped rules
    return rules.find(
      (r) => r.scope === 'workspace' && r.workspaceId === workspaceId && r.matchKey === matchKey
    )
  }

  clearRulesForThread(threadId: string): void {
    const rules = store.get('rules', [])
    store.set(
      'rules',
      rules.filter((r) => !(r.scope === 'thread' && r.threadId === threadId))
    )
  }

  clearRulesForWorkspace(workspaceId: string): void {
    const rules = store.get('rules', [])
    store.set(
      'rules',
      rules.filter((r) => r.workspaceId !== workspaceId)
    )
  }
}

export const permissionRuleService = new PermissionRuleService()
