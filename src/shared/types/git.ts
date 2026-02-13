// ============================================================
// Git & Worktree Types
// ============================================================

export interface GitStatus {
  branch: string
  isClean: boolean
  staged: string[]
  modified: string[]
  untracked: string[]
  ahead: number
  behind: number
}

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isMain: boolean
  sessionId?: string
  createdAt: string
}

export interface CommitResult {
  hash: string
  message: string
  branch: string
}
