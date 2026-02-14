import Store from 'electron-store'
import type { PersistedThread, SessionInfo, Message } from '@shared/types/session'
import { folderThreadStore } from './folder-thread-store'
import { logger } from '../util/logger'

interface ThreadStoreSchema {
  threads: PersistedThread[]
  migrationV1Complete?: boolean
}

const store = new Store<ThreadStoreSchema>({
  name: 'threads',
  defaults: { threads: [] }
})

/**
 * Dual-write persistence layer.
 * Primary source of truth: .agent/ folders in each workspace directory.
 * Secondary cache: electron-store threads.json for fast startup loading.
 */
export class ThreadStore {
  private _workspaceResolver: ((id: string) => { path: string } | undefined) | null = null

  /** Called by workspace-service after init to break circular dependency. */
  setWorkspaceResolver(resolver: (id: string) => { path: string } | undefined): void {
    this._workspaceResolver = resolver
  }

  /** Save or update a thread — writes to BOTH folder and cache. */
  save(session: SessionInfo): void {
    // Write to .agent/ folder (primary)
    this.writeToFolder(session.workspaceId, (workspacePath) => {
      folderThreadStore.saveThread(workspacePath, session)
    })

    // Write to electron-store cache (secondary)
    const persisted = toPersistedThread(session)
    const all = this.loadAll()
    const idx = all.findIndex((t) => t.sessionId === persisted.sessionId)
    if (idx >= 0) {
      all[idx] = persisted
    } else {
      all.push(persisted)
    }
    store.set('threads', all)
    logger.info(`Thread persisted: ${persisted.sessionId}`)
  }

  /** Update only messages — writes to BOTH folder and cache. */
  updateMessages(sessionId: string, messages: Message[]): void {
    const all = this.loadAll()
    const idx = all.findIndex((t) => t.sessionId === sessionId)
    if (idx < 0) return

    const strippedMessages = messages.map((m) => {
      const { isStreaming, ...rest } = m
      return rest
    })

    // Write to .agent/ folder (primary)
    this.writeToFolder(all[idx].workspaceId, (workspacePath) => {
      folderThreadStore.updateMessages(workspacePath, sessionId, strippedMessages)
    })

    // Write to electron-store cache (secondary)
    all[idx].messages = strippedMessages
    store.set('threads', all)
  }

  /** Rename a thread — updates title in BOTH folder and cache. */
  rename(sessionId: string, title: string): void {
    const all = this.loadAll()
    const idx = all.findIndex((t) => t.sessionId === sessionId)
    if (idx < 0) return

    all[idx].title = title

    // Update .agent/ folder manifest (primary)
    this.writeToFolder(all[idx].workspaceId, (workspacePath) => {
      folderThreadStore.updateManifestTitle(workspacePath, sessionId, title)
    })

    // Update electron-store cache (secondary)
    store.set('threads', all)
    logger.info(`Thread renamed: ${sessionId} → ${title}`)
  }

  /** Load all persisted threads from cache. */
  loadAll(): PersistedThread[] {
    return store.get('threads', [])
  }

  /** Remove a thread — removes from BOTH folder and cache. */
  remove(sessionId: string): void {
    const thread = this.loadAll().find((t) => t.sessionId === sessionId)

    // Remove from .agent/ folder (primary)
    if (thread) {
      this.writeToFolder(thread.workspaceId, (workspacePath) => {
        folderThreadStore.removeThread(workspacePath, sessionId)
      })
    }

    // Remove from electron-store cache (secondary)
    const all = this.loadAll().filter((t) => t.sessionId !== sessionId)
    store.set('threads', all)
    logger.info(`Thread removed from store: ${sessionId}`)
  }

  /** Rebuild the electron-store cache from all .agent/ folders across workspaces. */
  rebuildCacheFromFolders(
    workspaces: Array<{ path: string; id: string }>
  ): void {
    const threads = folderThreadStore.scanAllWorkspaces(workspaces)
    store.set('threads', threads)
    logger.info(
      `Cache rebuilt: ${threads.length} threads from ${workspaces.length} workspaces`
    )
  }

  /** Sync a single workspace's .agent/ threads into the cache. */
  syncWorkspaceToCache(workspacePath: string, workspaceId: string): void {
    const folderThreads = folderThreadStore.scanWorkspace(workspacePath, workspaceId)
    const all = this.loadAll()

    for (const ft of folderThreads) {
      const idx = all.findIndex((t) => t.sessionId === ft.sessionId)
      if (idx >= 0) {
        all[idx] = ft
      } else {
        all.push(ft)
      }
    }

    store.set('threads', all)
    if (folderThreads.length > 0) {
      logger.info(
        `Synced ${folderThreads.length} threads from workspace: ${workspacePath}`
      )
    }
  }

  /** Check if legacy migration has been completed. */
  isMigrationComplete(): boolean {
    return store.get('migrationV1Complete', false) as boolean
  }

  /** Mark legacy migration as complete. */
  setMigrationComplete(): void {
    store.set('migrationV1Complete', true)
  }

  /** Resolve workspace path for folder writes. Uses late-bound resolver to avoid circular deps. */
  private writeToFolder(
    workspaceId: string,
    action: (workspacePath: string) => void
  ): void {
    try {
      if (!this._workspaceResolver) {
        logger.warn('Workspace resolver not set yet, skipping folder write')
        return
      }
      const workspace = this._workspaceResolver(workspaceId)
      if (workspace) {
        action(workspace.path)
      }
    } catch (err) {
      logger.warn('Failed to write to folder store:', err)
    }
  }
}

function toPersistedThread(session: SessionInfo): PersistedThread {
  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
    agentName: session.agentName,
    title: session.title,
    createdAt: session.createdAt,
    worktreePath: session.worktreePath,
    worktreeBranch: session.worktreeBranch,
    workingDir: session.workingDir,
    messages: session.messages.map((m) => {
      const { isStreaming, ...rest } = m
      return rest
    }),
    useWorktree: session.useWorktree,
    workspaceId: session.workspaceId
  }
}

export const threadStore = new ThreadStore()
