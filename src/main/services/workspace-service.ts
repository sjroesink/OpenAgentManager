import Store from 'electron-store'
import { v4 as uuid } from 'uuid'
import type { WorkspaceInfo } from '@shared/types/workspace'
import { gitService } from './git-service'
import { threadStore } from './thread-store'

interface WorkspaceStoreSchema {
  workspaces: WorkspaceInfo[]
}

const store = new Store<WorkspaceStoreSchema>({
  name: 'workspaces',
  defaults: { workspaces: [] }
})

export class WorkspaceService {
  list(): WorkspaceInfo[] {
    return store.get('workspaces', [])
  }

  get(id: string): WorkspaceInfo | undefined {
    return this.list().find((w) => w.id === id)
  }

  async create(path: string, name?: string): Promise<WorkspaceInfo> {
    const all = this.list()
    const existing = all.find((w) => w.path === path)
    if (existing) {
      return existing
    }

    const isGitRepo = await gitService.isGitRepo(path)
    const gitBranch = isGitRepo ? await gitService.getBranch(path) : undefined

    const workspace: WorkspaceInfo = {
      id: uuid(),
      name: name || path.split(/[/\\]/).pop() || path,
      path,
      isGitRepo,
      gitBranch,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString()
    }

    all.push(workspace)
    store.set('workspaces', all)

    // Sync any existing .agent/ threads from this directory into the cache
    threadStore.syncWorkspaceToCache(path, workspace.id)

    return workspace
  }

  update(
    id: string,
    updates: Partial<
      Pick<WorkspaceInfo, 'name' | 'lastAccessedAt' | 'defaultAgentId' | 'defaultModelId' | 'defaultUseWorktree'>
    >
  ): WorkspaceInfo {
    const all = this.list()
    const idx = all.findIndex((w) => w.id === id)
    if (idx === -1) throw new Error(`Workspace not found: ${id}`)

    all[idx] = { ...all[idx], ...updates }
    store.set('workspaces', all)
    return all[idx]
  }

  remove(id: string): void {
    const all = this.list().filter((w) => w.id !== id)
    store.set('workspaces', all)
  }
}

export const workspaceService = new WorkspaceService()

// Wire up the late-bound resolver to break circular dependency
threadStore.setWorkspaceResolver((id) => workspaceService.get(id))
