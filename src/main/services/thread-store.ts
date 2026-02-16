import fs from 'fs'
import path from 'path'
import Store from 'electron-store'
import type { PersistedThread, SessionInfo, Message } from '@shared/types/session'
import { AGENT_DIR_NAME, THREADS_DIR_NAME } from '@shared/types/thread-format'
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

/** Shape required to resolve the storage path for a thread. */
interface ThreadPathInfo {
  useWorktree: boolean
  worktreePath?: string
  workspaceId: string
}

/**
 * Dual-write persistence layer.
 * Primary source of truth: .agent/ folders in each workspace or worktree directory.
 * Secondary cache: electron-store threads.json for fast startup loading.
 *
 * Worktree sessions store their .agent/ data inside the worktree directory,
 * making each worktree self-contained. Non-worktree sessions store in the
 * workspace directory as before.
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
    this.writeToFolder(session, (storagePath) => {
      folderThreadStore.saveThread(storagePath, session)
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

    // Lazy migration: clean up old data from workspace path if thread moved to worktree
    this.cleanupLegacyWorktreeThread(session)
  }

  /** Update only messages — writes to BOTH folder and cache. */
  updateMessages(sessionId: string, messages: Message[]): void {
    const all = this.loadAll()
    const idx = all.findIndex((t) => t.sessionId === sessionId)
    if (idx < 0) return

    const strippedMessages = messages.map((m) => {
      const rest = { ...m }
      delete rest.isStreaming
      return rest
    })

    // Write to .agent/ folder (primary)
    this.writeToFolder(all[idx], (storagePath) => {
      folderThreadStore.updateMessages(storagePath, sessionId, strippedMessages)
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
    this.writeToFolder(all[idx], (storagePath) => {
      folderThreadStore.updateManifestTitle(storagePath, sessionId, title)
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
      this.writeToFolder(thread, (storagePath) => {
        folderThreadStore.removeThread(storagePath, sessionId)
      })
    }

    // Remove from electron-store cache (secondary)
    const all = this.loadAll().filter((t) => t.sessionId !== sessionId)
    store.set('threads', all)
    logger.info(`Thread removed from store: ${sessionId}`)
  }

  /** Rebuild the electron-store cache from all .agent/ folders across workspaces and worktrees. */
  rebuildCacheFromFolders(
    workspaces: Array<{ path: string; id: string }>
  ): void {
    // Phase 1: Scan all workspace paths (catches non-worktree threads)
    const threads = folderThreadStore.scanAllWorkspaces(workspaces)
    const scannedPaths = new Set(workspaces.map((w) => w.path))

    // Phase 2: Collect known worktree paths from the existing cache
    const existingCache = store.get('threads', [])
    const worktreeEntries: Array<{ path: string; workspaceId: string }> = []

    for (const t of existingCache) {
      if (t.useWorktree && t.worktreePath && !scannedPaths.has(t.worktreePath)) {
        scannedPaths.add(t.worktreePath) // deduplicate
        worktreeEntries.push({ path: t.worktreePath, workspaceId: t.workspaceId })
      }
    }

    // Phase 3: Scan worktree paths for thread data
    for (const wt of worktreeEntries) {
      try {
        if (!fs.existsSync(wt.path)) continue
        const wtThreads = folderThreadStore.scanWorkspace(wt.path, wt.workspaceId)
        threads.push(...wtThreads)
      } catch (err) {
        logger.warn(`Failed to scan worktree path ${wt.path}:`, err)
      }
    }

    store.set('threads', threads)
    logger.info(
      `Cache rebuilt: ${threads.length} threads from ${workspaces.length} workspaces + ${worktreeEntries.length} worktrees`
    )
  }

  /** Sync a single workspace's .agent/ threads into the cache, including its worktree threads. */
  syncWorkspaceToCache(workspacePath: string, workspaceId: string): void {
    // Scan the workspace's own .agent/ folder
    const folderThreads = folderThreadStore.scanWorkspace(workspacePath, workspaceId)

    // Also scan worktree paths that belong to this workspace
    const existingCache = this.loadAll()
    const scannedPaths = new Set([workspacePath])

    for (const t of existingCache) {
      if (
        t.workspaceId === workspaceId &&
        t.useWorktree &&
        t.worktreePath &&
        !scannedPaths.has(t.worktreePath)
      ) {
        scannedPaths.add(t.worktreePath)
        try {
          if (!fs.existsSync(t.worktreePath)) continue
          const wtThreads = folderThreadStore.scanWorkspace(t.worktreePath, workspaceId)
          folderThreads.push(...wtThreads)
        } catch (err) {
          logger.warn(`Failed to scan worktree path ${t.worktreePath}:`, err)
        }
      }
    }

    // Merge into cache
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
        `Synced ${folderThreads.length} threads from workspace + worktrees: ${workspacePath}`
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

  /**
   * Resolve the storage path for a thread's .agent/ data.
   * Worktree sessions store data inside the worktree directory.
   * Non-worktree sessions store data in the workspace directory.
   */
  private resolveStoragePath(thread: ThreadPathInfo): string | null {
    // Worktree sessions: prefer worktree path if it exists on disk
    if (thread.useWorktree && thread.worktreePath) {
      if (fs.existsSync(thread.worktreePath)) {
        return thread.worktreePath
      }
      // Worktree no longer exists — fall back to workspace path
      logger.warn(
        `Worktree path no longer exists: ${thread.worktreePath}, falling back to workspace`
      )
    }

    // Non-worktree sessions or fallback: resolve workspace path
    if (!this._workspaceResolver) {
      logger.warn('Workspace resolver not set yet, skipping folder write')
      return null
    }
    const workspace = this._workspaceResolver(thread.workspaceId)
    return workspace?.path ?? null
  }

  /** Write to the correct .agent/ folder for a thread. */
  private writeToFolder(
    thread: ThreadPathInfo,
    action: (storagePath: string) => void
  ): void {
    try {
      const storagePath = this.resolveStoragePath(thread)
      if (storagePath) {
        action(storagePath)
      }
    } catch (err) {
      logger.warn('Failed to write to folder store:', err)
    }
  }

  /**
   * Lazy migration: if a worktree thread has stale data under the workspace path,
   * remove it after the thread has been written to the worktree path.
   */
  private cleanupLegacyWorktreeThread(
    thread: ThreadPathInfo & { sessionId: string }
  ): void {
    if (!thread.useWorktree || !thread.worktreePath) return

    try {
      const workspacePath = this._workspaceResolver?.(thread.workspaceId)?.path
      if (!workspacePath) return

      // Only clean up if the old location differs from the new one
      if (workspacePath === thread.worktreePath) return

      const oldThreadDir = path.join(
        workspacePath,
        AGENT_DIR_NAME,
        THREADS_DIR_NAME,
        thread.sessionId
      )
      if (fs.existsSync(oldThreadDir)) {
        fs.rmSync(oldThreadDir, { recursive: true, force: true })
        logger.info(
          `Cleaned up legacy worktree thread from workspace: ${thread.sessionId}`
        )
      }
    } catch (err) {
      logger.warn('Failed to clean up legacy worktree thread:', err)
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
      const rest = { ...m }
      delete rest.isStreaming
      return rest
    }),
    useWorktree: session.useWorktree,
    workspaceId: session.workspaceId,
    parentSessionId: session.parentSessionId
  }
}

export const threadStore = new ThreadStore()
