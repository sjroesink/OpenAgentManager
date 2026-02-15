import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { SessionInfo, Message, PersistedThread, ContentBlock } from '@shared/types/session'
import type {
  ThreadManifest,
  StoredMessage,
  AgentProjectConfig,
  StoredContentBlock,
  StoredToolCall
} from '@shared/types/thread-format'
import {
  ATSF_SPEC_VERSION,
  AGENT_DIR_NAME,
  THREADS_DIR_NAME,
  THREAD_MANIFEST_FILE,
  MESSAGES_FILE,
  ASSETS_DIR_NAME
} from '@shared/types/thread-format'
import { APP_NAME, CLIENT_INFO } from '../../shared/constants'
import { logger } from '../util/logger'

const DEFAULT_GITIGNORE = `# Agent Thread Storage Format - default .gitignore
# Conversation threads are not committed by default.
# They can be large and may contain sensitive content.

# Ignore message logs and binary assets
threads/*/messages.jsonl
threads/*/assets/

# Thread metadata is also ignored by default.
# Uncomment the next line to track thread metadata:
# !threads/*/thread.json
`

export class FolderThreadStore {
  // ---- Directory helpers ----

  getAgentDir(workspacePath: string): string {
    return path.join(workspacePath, AGENT_DIR_NAME)
  }

  getThreadsDir(workspacePath: string): string {
    return path.join(this.getAgentDir(workspacePath), THREADS_DIR_NAME)
  }

  getThreadDir(workspacePath: string, threadId: string): string {
    return path.join(this.getThreadsDir(workspacePath), threadId)
  }

  // ---- Initialization ----

  ensureAgentDir(workspacePath: string): void {
    const agentDir = this.getAgentDir(workspacePath)
    const threadsDir = this.getThreadsDir(workspacePath)

    fs.mkdirSync(threadsDir, { recursive: true })

    const configPath = path.join(agentDir, 'config.json')
    if (!fs.existsSync(configPath)) {
      const config: AgentProjectConfig = {
        specVersion: ATSF_SPEC_VERSION,
        createdBy: {
          name: APP_NAME,
          version: CLIENT_INFO.version
        }
      }
      this.writeJsonAtomic(configPath, config)
    }

    const gitignorePath = path.join(agentDir, '.gitignore')
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, DEFAULT_GITIGNORE, 'utf-8')
    }
  }

  // ---- Thread CRUD ----

  saveThread(workspacePath: string, session: SessionInfo): void {
    this.ensureAgentDir(workspacePath)
    const threadDir = this.getThreadDir(workspacePath, session.sessionId)
    fs.mkdirSync(threadDir, { recursive: true })

    // Write thread.json
    const manifest = this.sessionToManifest(session)
    this.writeJsonAtomic(path.join(threadDir, THREAD_MANIFEST_FILE), manifest)

    // Write messages.jsonl
    const messagesPath = path.join(threadDir, MESSAGES_FILE)
    const lines = session.messages.map((m) => {
      const stored = this.messageToStored(m, threadDir)
      return JSON.stringify(stored)
    })
    fs.writeFileSync(messagesPath, lines.length > 0 ? lines.join('\n') + '\n' : '', 'utf-8')

    logger.info(`Thread saved to folder: ${session.sessionId}`)
  }

  updateMessages(workspacePath: string, threadId: string, messages: Message[]): void {
    const threadDir = this.getThreadDir(workspacePath, threadId)
    if (!fs.existsSync(threadDir)) {
      logger.warn(`Thread dir not found for update: ${threadDir}`)
      return
    }

    // Rewrite messages.jsonl
    const messagesPath = path.join(threadDir, MESSAGES_FILE)
    const lines = messages.map((m) => {
      const { isStreaming, ...rest } = m
      const stored = this.messageToStored(rest as Message, threadDir)
      return JSON.stringify(stored)
    })
    fs.writeFileSync(messagesPath, lines.length > 0 ? lines.join('\n') + '\n' : '', 'utf-8')

    // Update thread.json stats
    this.updateManifestStats(threadDir, messages)
  }

  updateManifestTitle(workspacePath: string, threadId: string, title: string): void {
    const threadDir = this.getThreadDir(workspacePath, threadId)
    const manifestPath = path.join(threadDir, THREAD_MANIFEST_FILE)
    if (!fs.existsSync(manifestPath)) return

    try {
      const manifest: ThreadManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      manifest.title = title
      this.writeJsonAtomic(manifestPath, manifest)
    } catch (err) {
      logger.warn(`Failed to update manifest title: ${manifestPath}`, err)
    }
  }

  removeThread(workspacePath: string, threadId: string): void {
    const threadDir = this.getThreadDir(workspacePath, threadId)
    if (fs.existsSync(threadDir)) {
      fs.rmSync(threadDir, { recursive: true, force: true })
      logger.info(`Thread removed from folder: ${threadId}`)
    }
  }

  // ---- Read operations ----

  readManifest(workspacePath: string, threadId: string): ThreadManifest | null {
    const manifestPath = path.join(
      this.getThreadDir(workspacePath, threadId),
      THREAD_MANIFEST_FILE
    )
    if (!fs.existsSync(manifestPath)) return null
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      logger.warn(`Failed to read thread manifest: ${manifestPath}`, err)
      return null
    }
  }

  readMessages(workspacePath: string, threadId: string): StoredMessage[] {
    const messagesPath = path.join(
      this.getThreadDir(workspacePath, threadId),
      MESSAGES_FILE
    )
    if (!fs.existsSync(messagesPath)) return []
    try {
      const content = fs.readFileSync(messagesPath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim().length > 0)
      return lines.map((line) => JSON.parse(line) as StoredMessage)
    } catch (err) {
      logger.warn(`Failed to read messages: ${messagesPath}`, err)
      return []
    }
  }

  listThreadIds(workspacePath: string): string[] {
    const threadsDir = this.getThreadsDir(workspacePath)
    if (!fs.existsSync(threadsDir)) return []
    try {
      return fs
        .readdirSync(threadsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return []
    }
  }

  listManifests(workspacePath: string): ThreadManifest[] {
    const threadIds = this.listThreadIds(workspacePath)
    const manifests: ThreadManifest[] = []
    for (const id of threadIds) {
      const manifest = this.readManifest(workspacePath, id)
      if (manifest) manifests.push(manifest)
    }
    return manifests
  }

  // ---- Conversion: internal -> stored ----

  messageToStored(message: Message, threadDir: string): StoredMessage {
    const content: StoredContentBlock[] = message.content.map((block) =>
      this.contentBlockToStored(block, threadDir)
    )

    const stored: StoredMessage = {
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      content
    }

    if (message.toolCalls && message.toolCalls.length > 0) {
      stored.toolCalls = message.toolCalls.map((tc) => {
        const stc: StoredToolCall = {
          toolCallId: tc.toolCallId,
          name: tc.name,
          title: tc.title,
          status: tc.status
        }
        if (tc.kind) stc.kind = tc.kind
        if (tc.input !== undefined) stc.input = tc.input
        if (tc.output !== undefined) stc.output = tc.output
        if (tc.diff) stc.diff = tc.diff
        if (tc.locations) stc.locations = tc.locations
        return stc
      })
    }

    return stored
  }

  storedToMessage(stored: StoredMessage, threadDir: string): Message {
    const content: ContentBlock[] = stored.content.map((block) =>
      this.storedToContentBlock(block, threadDir)
    )

    const message: Message = {
      id: stored.id,
      role: stored.role === 'system' ? 'agent' : stored.role,
      timestamp: stored.timestamp,
      content
    }

    if (stored.toolCalls && stored.toolCalls.length > 0) {
      message.toolCalls = stored.toolCalls.map((stc) => ({
        toolCallId: stc.toolCallId,
        name: stc.name,
        title: stc.title || stc.name,
        kind: stc.kind as import('@shared/types/session').ToolCallKind | undefined,
        status: stc.status,
        input: stc.input,
        output: stc.output,
        diff: stc.diff,
        locations: stc.locations
      }))
    }

    return message
  }

  sessionToManifest(session: SessionInfo): ThreadManifest {
    const stats = this.computeStats(session.messages)
    const lastMessage = session.messages[session.messages.length - 1]

    return {
      specVersion: ATSF_SPEC_VERSION,
      threadId: session.sessionId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: lastMessage?.timestamp || session.createdAt,
      agent: {
        id: session.agentId,
        name: session.agentName,
        protocol: 'acp'
      },
      context: {
        workingDir: session.workingDir,
        ...(session.worktreePath && session.worktreeBranch
          ? {
              worktree: {
                path: session.worktreePath,
                branch: session.worktreeBranch
              }
            }
          : {})
      },
      stats,
      parentThreadId: session.parentSessionId
    }
  }

  manifestToPersistedThread(
    manifest: ThreadManifest,
    messages: Message[],
    workspaceId: string
  ): PersistedThread {
    return {
      sessionId: manifest.threadId,
      agentId: manifest.agent.id,
      agentName: manifest.agent.name,
      title: manifest.title,
      createdAt: manifest.createdAt,
      worktreePath: manifest.context.worktree?.path,
      worktreeBranch: manifest.context.worktree?.branch,
      workingDir: manifest.context.workingDir,
      messages,
      useWorktree: !!manifest.context.worktree,
      workspaceId,
      parentSessionId: manifest.parentThreadId
    }
  }

  // ---- Scanning (for cache rebuild) ----

  scanWorkspace(workspacePath: string, workspaceId: string): PersistedThread[] {
    const threads: PersistedThread[] = []
    const threadIds = this.listThreadIds(workspacePath)

    for (const threadId of threadIds) {
      try {
        const manifest = this.readManifest(workspacePath, threadId)
        if (!manifest) continue

        const threadDir = this.getThreadDir(workspacePath, threadId)
        const storedMessages = this.readMessages(workspacePath, threadId)
        const messages = storedMessages.map((sm) => this.storedToMessage(sm, threadDir))

        threads.push(this.manifestToPersistedThread(manifest, messages, workspaceId))
      } catch (err) {
        logger.warn(`Failed to scan thread ${threadId} in ${workspacePath}:`, err)
      }
    }

    return threads
  }

  scanAllWorkspaces(
    workspaces: Array<{ path: string; id: string }>
  ): PersistedThread[] {
    const allThreads: PersistedThread[] = []
    for (const ws of workspaces) {
      const threads = this.scanWorkspace(ws.path, ws.id)
      allThreads.push(...threads)
    }
    return allThreads
  }

  // ---- Migration ----

  migrateFromLegacy(
    legacyThreads: PersistedThread[],
    workspaceResolver: (workspaceId: string) => string | undefined
  ): { migrated: number; skipped: number; failed: number } {
    let migrated = 0
    let skipped = 0
    let failed = 0

    for (const thread of legacyThreads) {
      const workspacePath = workspaceResolver(thread.workspaceId)
      if (!workspacePath) {
        logger.warn(`Migration: no workspace path for thread ${thread.sessionId}`)
        failed++
        continue
      }

      const threadDir = this.getThreadDir(workspacePath, thread.sessionId)
      if (fs.existsSync(path.join(threadDir, THREAD_MANIFEST_FILE))) {
        skipped++
        continue
      }

      try {
        const sessionLike: SessionInfo = {
          sessionId: thread.sessionId,
          connectionId: '',
          agentId: thread.agentId,
          agentName: thread.agentName,
          title: thread.title,
          createdAt: thread.createdAt,
          worktreePath: thread.worktreePath,
          worktreeBranch: thread.worktreeBranch,
          workingDir: thread.workingDir,
          status: 'idle',
          messages: thread.messages,
          useWorktree: thread.useWorktree,
          workspaceId: thread.workspaceId
        }
        this.saveThread(workspacePath, sessionLike)
        migrated++
      } catch (err) {
        logger.warn(`Migration failed for thread ${thread.sessionId}:`, err)
        failed++
      }
    }

    logger.info(
      `Migration complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed`
    )
    return { migrated, skipped, failed }
  }

  // ---- Asset management ----

  private saveAsset(threadDir: string, data: string, mimeType: string): string {
    const assetsDir = path.join(threadDir, ASSETS_DIR_NAME)
    fs.mkdirSync(assetsDir, { recursive: true })

    const buffer = Buffer.from(data, 'base64')
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    const ext = this.mimeToExt(mimeType)
    const filename = `sha256-${hash}.${ext}`
    const assetPath = path.join(assetsDir, filename)

    if (!fs.existsSync(assetPath)) {
      fs.writeFileSync(assetPath, buffer)
    }

    return filename
  }

  private loadAsset(
    threadDir: string,
    assetRef: string
  ): { data: string; mimeType: string } | null {
    const assetPath = path.join(threadDir, ASSETS_DIR_NAME, assetRef)
    if (!fs.existsSync(assetPath)) return null
    const buffer = fs.readFileSync(assetPath)
    const ext = path.extname(assetRef).slice(1)
    return {
      data: buffer.toString('base64'),
      mimeType: this.extToMime(ext)
    }
  }

  // ---- Private helpers ----

  private contentBlockToStored(block: ContentBlock, threadDir: string): StoredContentBlock {
    switch (block.type) {
      case 'image': {
        const assetRef = this.saveAsset(threadDir, block.data, block.mimeType)
        return { type: 'image', assetRef, mimeType: block.mimeType }
      }
      case 'audio': {
        const assetRef = this.saveAsset(threadDir, block.data, block.mimeType)
        return { type: 'audio', assetRef, mimeType: block.mimeType }
      }
      case 'resource': {
        if (block.resource.blob) {
          const ext = block.resource.mimeType?.split('/')[1] || 'bin'
          const assetRef = this.saveAsset(threadDir, block.resource.blob, block.resource.mimeType || `application/${ext}`)
          return { type: 'resource', uri: block.resource.uri, mimeType: block.resource.mimeType, text: block.resource.text, assetRef }
        }
        return { type: 'resource', uri: block.resource.uri, mimeType: block.resource.mimeType, text: block.resource.text }
      }
      case 'resource_link':
        return { type: 'resource_link', uri: block.uri, name: block.name, mimeType: block.mimeType, title: block.title, description: block.description, size: block.size }
      case 'text':
      case 'thinking':
      case 'tool_call_ref':
        return block
    }
  }

  private storedToContentBlock(block: StoredContentBlock, threadDir: string): ContentBlock {
    switch (block.type) {
      case 'image': {
        const asset = this.loadAsset(threadDir, block.assetRef)
        if (asset) return { type: 'image', data: asset.data, mimeType: asset.mimeType }
        return { type: 'text', text: `[Missing image: ${block.assetRef}]` }
      }
      case 'audio': {
        const asset = this.loadAsset(threadDir, block.assetRef)
        if (asset) return { type: 'audio', data: asset.data, mimeType: asset.mimeType }
        return { type: 'text', text: `[Missing audio: ${block.assetRef}]` }
      }
      case 'resource': {
        const resource: import('@shared/types/session').EmbeddedResourceData = {
          uri: block.uri,
          mimeType: block.mimeType,
          text: block.text
        }
        if (block.assetRef) {
          const asset = this.loadAsset(threadDir, block.assetRef)
          if (asset) resource.blob = asset.data
        }
        return { type: 'resource', resource }
      }
      case 'resource_link':
        return { type: 'resource_link', uri: block.uri, name: block.name, mimeType: block.mimeType, title: block.title, description: block.description, size: block.size }
      case 'text':
      case 'thinking':
      case 'tool_call_ref':
        return block
    }
  }

  private computeStats(messages: Message[]): ThreadManifest['stats'] {
    let userMessageCount = 0
    let agentMessageCount = 0
    let toolCallCount = 0

    for (const m of messages) {
      if (m.role === 'user') userMessageCount++
      else agentMessageCount++
      if (m.toolCalls) toolCallCount += m.toolCalls.length
    }

    return {
      messageCount: messages.length,
      userMessageCount,
      agentMessageCount,
      toolCallCount
    }
  }

  private updateManifestStats(threadDir: string, messages: Message[]): void {
    const manifestPath = path.join(threadDir, THREAD_MANIFEST_FILE)
    if (!fs.existsSync(manifestPath)) return

    try {
      const manifest: ThreadManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      manifest.stats = this.computeStats(messages)
      const lastMessage = messages[messages.length - 1]
      if (lastMessage) {
        manifest.updatedAt = lastMessage.timestamp
      }
      this.writeJsonAtomic(manifestPath, manifest)
    } catch (err) {
      logger.warn(`Failed to update manifest stats: ${manifestPath}`, err)
    }
  }

  private writeJsonAtomic(filePath: string, data: unknown): void {
    const tmpPath = filePath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    fs.renameSync(tmpPath, filePath)
  }

  private mimeToExt(mimeType: string): string {
    const map: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg'
    }
    return map[mimeType] || 'bin'
  }

  private extToMime(ext: string): string {
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml'
    }
    return map[ext] || 'application/octet-stream'
  }
}

export const folderThreadStore = new FolderThreadStore()
