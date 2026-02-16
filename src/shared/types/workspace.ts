import type { InteractionMode } from './session'

// ============================================================
// Workspace Types
// ============================================================

export interface WorkspaceInfo {
  id: string
  name: string
  path: string
  defaultAgentId?: string
  defaultModelId?: string
  defaultInteractionMode?: InteractionMode
  defaultUseWorktree?: boolean
  isGitRepo: boolean
  gitBranch?: string
  createdAt: string
  lastAccessedAt: string
}
