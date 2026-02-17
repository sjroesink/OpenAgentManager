import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { agentManager } from '../services/agent-manager'
import { sessionManager } from '../services/session-manager'
import { workspaceService } from '../services/workspace-service'
import { gitService } from '../services/git-service'
import { fileService } from '../services/file-service'
import { settingsService } from '../services/settings-service'
import { threadStore } from '../services/thread-store'
import type { AppSettings } from '@shared/types/settings'
import type { McpServerConfig } from '@shared/types/settings'
import { getAppDataDir } from '../util/paths'
import { logger } from '../util/logger'

let server: http.Server | null = null
let authToken: string | null = null

const DEFAULT_PORT = 19275

type RouteHandler = (body: Record<string, unknown>) => Promise<unknown>

const routes: Record<string, RouteHandler> = {
  '/api/health': async () => {
    const workspaces = workspaceService.list()
    const sessions = sessionManager.listSessions()
    const connections = agentManager.listConnections()
    return {
      running: true,
      workspaceCount: workspaces.length,
      sessionCount: sessions.length,
      connectionCount: connections.length
    }
  },

  '/api/workspace/list': async () => {
    return workspaceService.list()
  },

  '/api/workspace/create': async (body) => {
    return workspaceService.create(body.path as string, body.name as string | undefined)
  },

  '/api/agent/list-installed': async () => {
    return agentManager.listInstalled()
  },

  '/api/agent/list-connections': async () => {
    return agentManager.listConnections()
  },

  '/api/agent/launch': async (body) => {
    return agentManager.launch(body.agentId as string, body.projectPath as string)
  },

  '/api/agent/terminate': async (body) => {
    agentManager.terminate(body.connectionId as string)
    return { success: true }
  },

  '/api/session/create': async (body) => {
    return sessionManager.createSession({
      connectionId: body.connectionId as string,
      workingDir: body.workingDir as string,
      useWorktree: (body.useWorktree as boolean) || false,
      workspaceId: body.workspaceId as string,
      interactionMode: body.mode as 'ask' | 'code' | 'plan' | 'act' | undefined,
      title: body.title as string | undefined
    })
  },

  '/api/session/list': async () => {
    // Return metadata only, omit messages for brevity
    return sessionManager.listSessions().map((s) => ({
      sessionId: s.sessionId,
      connectionId: s.connectionId,
      agentId: s.agentId,
      agentName: s.agentName,
      title: s.title,
      createdAt: s.createdAt,
      status: s.status,
      workingDir: s.workingDir,
      interactionMode: s.interactionMode,
      worktreePath: s.worktreePath,
      worktreeBranch: s.worktreeBranch,
      useWorktree: s.useWorktree,
      workspaceId: s.workspaceId,
      parentSessionId: s.parentSessionId,
      messageCount: s.messages.length
    }))
  },

  '/api/session/list-persisted': async () => {
    // Return metadata only
    return threadStore.loadAll().map((t) => ({
      sessionId: t.sessionId,
      agentId: t.agentId,
      agentName: t.agentName,
      title: t.title,
      createdAt: t.createdAt,
      workingDir: t.workingDir,
      interactionMode: t.interactionMode,
      worktreePath: t.worktreePath,
      worktreeBranch: t.worktreeBranch,
      useWorktree: t.useWorktree,
      workspaceId: t.workspaceId,
      parentSessionId: t.parentSessionId,
      messageCount: t.messages?.length ?? 0
    }))
  },

  '/api/session/get': async (body) => {
    const session = sessionManager.getSession(body.sessionId as string)
    if (!session) {
      // Try persisted threads
      const persisted = threadStore.loadAll().find((t) => t.sessionId === body.sessionId)
      if (!persisted) throw new Error(`Session not found: ${body.sessionId}`)
      return persisted
    }
    return session
  },

  '/api/session/prompt': async (body) => {
    return sessionManager.prompt(
      body.sessionId as string,
      [{ type: 'text', text: body.text as string }],
      body.mode as 'ask' | 'code' | 'plan' | 'act' | undefined
    )
  },

  '/api/session/cancel': async (body) => {
    await sessionManager.cancel(body.sessionId as string)
    return { success: true }
  },

  '/api/session/remove': async (body) => {
    await sessionManager.removeSession(
      body.sessionId as string,
      (body.cleanupWorktree as boolean) || false
    )
    return { success: true }
  },

  '/api/session/fork': async (body) => {
    return sessionManager.forkSession(
      body.sessionId as string,
      body.title as string | undefined
    )
  },

  '/api/session/pending-permissions': async () => {
    return sessionManager.listPendingPermissions()
  },

  '/api/session/permission-response': async (body) => {
    const requestId = body.requestId as string
    const optionId = body.optionId as string
    // Validate that the request ID is actually pending
    const pending = sessionManager.listPendingPermissions()
    const match = pending.find((p) => p.requestId === requestId)
    if (!match) {
      throw new Error('No pending permission with that requestId')
    }
    // Validate that the option ID is valid for this request
    const validOption = match.options.some((o) => o.optionId === optionId)
    if (!validOption) {
      throw new Error('Invalid optionId for this permission request')
    }
    sessionManager.resolvePermission({ requestId, optionId })
    return { success: true }
  },

  '/api/git/status': async (body) => {
    return gitService.getStatus(body.projectPath as string)
  },

  '/api/git/diff': async (body) => {
    return gitService.getDiff(
      body.workingDir as string,
      body.filePath as string | undefined
    )
  },

  '/api/file/read-tree': async (body) => {
    return fileService.readTree(
      body.dirPath as string,
      (body.depth as number) || 3
    )
  },

  '/api/file/read': async (body) => {
    return { content: fileService.readFile(body.filePath as string) }
  },

  '/api/settings/get': async () => {
    return settingsService.get()
  },

  '/api/settings/set': async (body) => {
    settingsService.set(body as Partial<AppSettings>)
    return { success: true }
  },

  '/api/mcp/list-servers': async () => {
    return settingsService.getMcpServers()
  },

  '/api/mcp/add-server': async (body) => {
    settingsService.addMcpServer(body as unknown as McpServerConfig)
    return { success: true }
  },

  '/api/mcp/remove-server': async (body) => {
    settingsService.removeMcpServer(body.serverId as string)
    return { success: true }
  },

  '/api/mcp/update-server': async (body) => {
    const { serverId, ...updates } = body as { serverId: string } & Partial<McpServerConfig>
    settingsService.updateMcpServer(serverId, updates)
    return { success: true }
  }
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const json = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json)
  })
  res.end(json)
}

export function startInternalApi(): void {
  const port = parseInt(process.env.AM_MCP_PORT || '', 10) || DEFAULT_PORT

  // Generate auth token
  authToken = crypto.randomBytes(32).toString('hex')

  // Write discovery files
  const dataDir = getAppDataDir()
  fs.writeFileSync(path.join(dataDir, 'mcp-port'), String(port), 'utf-8')
  fs.writeFileSync(path.join(dataDir, 'mcp-token'), authToken, 'utf-8')

  server = http.createServer(async (req, res) => {
    // CORS headers for local use — full origin with protocol and port
    res.setHeader('Access-Control-Allow-Origin', `http://127.0.0.1:${port}`)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    // Auth check
    const authHeader = req.headers.authorization
    if (!authHeader || authHeader !== `Bearer ${authToken}`) {
      sendJson(res, 401, { error: 'Unauthorized' })
      return
    }

    const route = routes[req.url || '']
    if (!route) {
      sendJson(res, 404, { error: `Unknown endpoint: ${req.url}` })
      return
    }

    try {
      const body = await parseBody(req)
      const result = await route(body)
      sendJson(res, 200, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`MCP API error [${req.url}]:`, message)
      // Return generic error to client, keep details server-side
      sendJson(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' })
    }
  })

  server.listen(port, '127.0.0.1', () => {
    logger.info(`MCP internal API listening on http://127.0.0.1:${port}`)
  })

  server.on('error', (err) => {
    logger.error('MCP internal API server error:', err)
  })

  // Set generous timeout for long-running operations like session/prompt
  server.timeout = 10 * 60 * 1000 // 10 minutes
  server.keepAliveTimeout = 10 * 60 * 1000
}

export function stopInternalApi(): void {
  if (server) {
    server.close()
    server = null
  }

  // Clean up discovery files
  try {
    const dataDir = getAppDataDir()
    const portFile = path.join(dataDir, 'mcp-port')
    const tokenFile = path.join(dataDir, 'mcp-token')
    if (fs.existsSync(portFile)) fs.unlinkSync(portFile)
    if (fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile)
  } catch {
    // Best-effort cleanup
  }

  authToken = null
}
