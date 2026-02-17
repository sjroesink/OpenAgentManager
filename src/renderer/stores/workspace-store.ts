import { create } from 'zustand'
import type { WorkspaceInfo } from '@shared/types/workspace'

interface WorkspaceState {
  workspaces: WorkspaceInfo[]
  expandedWorkspaceIds: Record<string, boolean>
  loading: boolean

  // Actions
  loadWorkspaces: () => Promise<void>
  createWorkspace: (path: string, name?: string) => Promise<WorkspaceInfo>
  removeWorkspace: (id: string, cleanupWorktrees?: boolean) => Promise<void>
  toggleExpanded: (id: string) => void
  openInVSCode: (path: string) => Promise<void>
  touchWorkspace: (id: string) => Promise<void>
  updateWorkspace: (
    id: string,
    updates: Partial<Pick<WorkspaceInfo, 'name' | 'lastAccessedAt' | 'defaultAgentId' | 'defaultModelId' | 'defaultInteractionMode' | 'defaultUseWorktree'>>
  ) => Promise<WorkspaceInfo>
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  expandedWorkspaceIds: {},
  loading: false,

  loadWorkspaces: async () => {
    set({ loading: true })
    try {
      const workspaces = await window.api.invoke('workspace:list', undefined)
      const expandedIds: Record<string, boolean> = {}
      for (const w of workspaces) {
        expandedIds[w.id] = true
      }
      set({ workspaces, expandedWorkspaceIds: expandedIds, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createWorkspace: async (path, name) => {
    const workspace = await window.api.invoke('workspace:create', { path, name })
    set((state) => ({
      workspaces: state.workspaces.some((w) => w.id === workspace.id)
        ? state.workspaces
        : [...state.workspaces, workspace],
      expandedWorkspaceIds: {
        ...state.expandedWorkspaceIds,
        [workspace.id]: true
      }
    }))
    return workspace
  },

  removeWorkspace: async (id, cleanupWorktrees = false) => {
    await window.api.invoke('workspace:remove', { id, cleanupWorktrees })
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== id)
    }))
  },

  toggleExpanded: (id) => {
    set((state) => ({
      expandedWorkspaceIds: {
        ...state.expandedWorkspaceIds,
        [id]: !state.expandedWorkspaceIds[id]
      }
    }))
  },

  openInVSCode: async (path) => {
    await window.api.invoke('workspace:open-in-vscode', { path })
  },

  touchWorkspace: async (id) => {
    try {
      const updated = await window.api.invoke('workspace:update', {
        id,
        updates: { lastAccessedAt: new Date().toISOString() }
      })
      set((state) => ({
        workspaces: state.workspaces.map((w) => (w.id === id ? updated : w))
      }))
    } catch {
      // Ignore touch errors
    }
  },

  updateWorkspace: async (id, updates) => {
    const updated = await window.api.invoke('workspace:update', { id, updates })
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === id ? updated : w))
    }))
    return updated
  }
}))
