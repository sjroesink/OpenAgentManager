// ============================================================
// Workspace Types
// ============================================================

export interface WorkspaceInfo {
  id: string
  name: string
  path: string
  defaultAgentId?: string
  defaultModelId?: string
  defaultUseWorktree?: boolean
  isGitRepo: boolean
  gitBranch?: string
  createdAt: string
  lastAccessedAt: string
}
