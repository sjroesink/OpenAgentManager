import { create } from 'zustand'
import type { ProjectInfo, FileTreeNode } from '@shared/types/project'
import type { GitStatus } from '@shared/types/git'

interface ProjectState {
  project: ProjectInfo | null
  fileTree: FileTreeNode[]
  fileTreeLoading: boolean
  gitStatus: GitStatus | null

  // Actions
  openProject: (path: string) => Promise<void>
  selectDirectory: () => Promise<void>
  loadFileTree: () => Promise<void>
  refreshGitStatus: () => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  fileTree: [],
  fileTreeLoading: false,
  gitStatus: null,

  openProject: async (projectPath: string) => {
    const project = await window.api.invoke('project:open', { path: projectPath })
    set({ project })

    // Load file tree and git status in parallel
    const { loadFileTree, refreshGitStatus } = get()
    await Promise.all([loadFileTree(), refreshGitStatus()])
  },

  selectDirectory: async () => {
    const path = await window.api.invoke('project:select-directory', undefined)
    if (path) {
      await get().openProject(path)
    }
  },

  loadFileTree: async () => {
    const { project } = get()
    if (!project) return

    set({ fileTreeLoading: true })
    try {
      const tree = await window.api.invoke('file:read-tree', { dirPath: project.path, depth: 3 })
      set({ fileTree: tree, fileTreeLoading: false })
    } catch {
      set({ fileTreeLoading: false })
    }
  },

  refreshGitStatus: async () => {
    const { project } = get()
    if (!project || !project.isGitRepo) return

    try {
      const gitStatus = await window.api.invoke('git:status', { projectPath: project.path })
      set({ gitStatus })
    } catch {
      // Not a git repo or error
    }
  }
}))
