// ============================================================
// Project & File Types
// ============================================================

export interface ProjectInfo {
  path: string
  name: string
  isGitRepo: boolean
  gitBranch?: string
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
  extension?: string
  size?: number
}

export interface FileChange {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string
  additions: number
  deletions: number
}

export interface DiffResult {
  files: FileDiff[]
}

export interface FileDiff {
  path: string
  oldContent: string
  newContent: string
}
