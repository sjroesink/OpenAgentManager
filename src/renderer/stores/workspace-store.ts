import { create } from 'zustand'
import type { WorkspaceInfo } from '@shared/types/workspace'

interface WorkspaceState {
  workspaces: WorkspaceInfo[]
  expandedWorkspaceIds: Set<string>
  loading: boolean

  // Actions
  loadWorkspaces: () => Promise<void>
  createWorkspace: (path: string, name?: string) => Promise<WorkspaceInfo>
  removeWorkspace: (id: string) => Promise<void>
  toggleExpanded: (id: string) => void
  openInVSCode: (path: string) => Promise<void>
  touchWorkspace: (id: string) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  expandedWorkspaceIds: new Set<string>(),
  loading: false,

  loadWorkspaces: async () => {
    set({ loading: true })
    try {
      const workspaces = await window.api.invoke('workspace:list', undefined)
      const expandedIds = new Set(workspaces.map((w) => w.id))
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
      expandedWorkspaceIds: new Set([...state.expandedWorkspaceIds, workspace.id])
    }))
    return workspace
  },

  removeWorkspace: async (id) => {
    await window.api.invoke('workspace:remove', { id })
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== id)
    }))
  },

  toggleExpanded: (id) => {
    set((state) => {
      const next = new Set(state.expandedWorkspaceIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedWorkspaceIds: next }
    })
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
  }
}))
