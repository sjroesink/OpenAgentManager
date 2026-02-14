// ============================================================
// Workspace Types
// ============================================================

export interface WorkspaceInfo {
  id: string
  name: string
  path: string
  isGitRepo: boolean
  gitBranch?: string
  createdAt: string
  lastAccessedAt: string
}
