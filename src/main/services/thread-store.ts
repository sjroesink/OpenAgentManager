import Store from 'electron-store'
import type { PersistedThread, SessionInfo, Message } from '@shared/types/session'
import { logger } from '../util/logger'

interface ThreadStoreSchema {
  threads: PersistedThread[]
}

const store = new Store<ThreadStoreSchema>({
  name: 'threads',
  defaults: { threads: [] }
})

/**
 * Persists thread metadata and message history to disk via electron-store.
 */
export class ThreadStore {
  /** Save or update a thread from a live SessionInfo. */
  save(session: SessionInfo): void {
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

  /** Update only messages for an existing thread. */
  updateMessages(sessionId: string, messages: Message[]): void {
    const all = this.loadAll()
    const idx = all.findIndex((t) => t.sessionId === sessionId)
    if (idx < 0) return
    // Strip isStreaming from messages before persisting
    all[idx].messages = messages.map((m) => {
      const { isStreaming, ...rest } = m
      return rest
    })
    store.set('threads', all)
  }

  /** Load all persisted threads. */
  loadAll(): PersistedThread[] {
    return store.get('threads', [])
  }

  /** Remove a thread by sessionId. */
  remove(sessionId: string): void {
    const all = this.loadAll().filter((t) => t.sessionId !== sessionId)
    store.set('threads', all)
    logger.info(`Thread removed from store: ${sessionId}`)
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
