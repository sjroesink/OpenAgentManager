import { ChildProcess, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { BrowserWindow } from 'electron'
import { ACP_PROTOCOL_VERSION, CLIENT_INFO } from '@shared/constants'
import type {
  AgentCapabilities,
  AgentConnection,
  AuthMethod
} from '@shared/types/agent'
import type {
  SessionUpdateEvent,
  PermissionRequestEvent,
  PermissionResponse
} from '@shared/types/session'
import { logger } from '../util/logger'

// ============================================================
// ACP Client - Wraps a child process agent via ACP protocol
//
// Uses raw JSON-RPC 2.0 over newline-delimited JSON on stdio
// since the @agentclientprotocol/sdk may not be fully available.
// This implementation speaks the protocol directly.
// ============================================================

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number
  method?: string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  params?: unknown
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type PermissionResolver = (response: PermissionResponse) => void

export class AcpClient {
  readonly connectionId: string
  private childProcess: ChildProcess | null = null
  private nextId = 1
  private pendingRequests = new Map<number, PendingRequest>()
  private buffer = ''
  private mainWindow: BrowserWindow | null = null
  private permissionResolvers = new Map<string, PermissionResolver>()

  // Public state
  capabilities: AgentCapabilities | null = null
  authMethods: AuthMethod[] = []
  agentName = 'Unknown Agent'
  agentVersion = ''

  constructor(
    public readonly agentId: string,
    private spawnCommand: string,
    private spawnArgs: string[],
    private spawnEnv: Record<string, string>,
    private cwd: string
  ) {
    this.connectionId = uuid()
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** Spawn the agent and connect via stdio */
  async start(): Promise<void> {
    logger.info(`Spawning agent: ${this.spawnCommand} ${this.spawnArgs.join(' ')}`)

    this.childProcess = spawn(this.spawnCommand, this.spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.cwd,
      env: { ...process.env, ...this.spawnEnv },
      shell: process.platform === 'win32'
    })

    // Handle stdout (JSON-RPC messages from agent)
    this.childProcess.stdout!.on('data', (data: Buffer) => {
      this.handleData(data.toString())
    })

    // Log stderr
    this.childProcess.stderr!.on('data', (data: Buffer) => {
      logger.debug(`[${this.agentId}:stderr] ${data.toString().trim()}`)
    })

    this.childProcess.on('exit', (code, signal) => {
      logger.info(`Agent ${this.agentId} exited: code=${code}, signal=${signal}`)
      this.rejectAllPending(new Error(`Agent process exited: code=${code}`))
    })

    this.childProcess.on('error', (err) => {
      logger.error(`Agent ${this.agentId} spawn error:`, err)
      this.rejectAllPending(err)
    })
  }

  /** Initialize the ACP connection */
  async initialize(): Promise<{
    capabilities: AgentCapabilities
    authMethods: AuthMethod[]
    agentName: string
    agentVersion: string
  }> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: CLIENT_INFO,
      capabilities: {
        textFiles: true,
        terminals: true
      }
    }) as {
      protocolVersion?: number
      agentInfo?: { name: string; version: string }
      agentCapabilities?: AgentCapabilities
      authMethods?: AuthMethod[]
    }

    this.agentName = result.agentInfo?.name || this.agentId
    this.agentVersion = result.agentInfo?.version || ''
    this.capabilities = result.agentCapabilities || null
    this.authMethods = result.authMethods || []

    logger.info(
      `Agent initialized: ${this.agentName} v${this.agentVersion}, ` +
      `auth methods: ${this.authMethods.map((a) => a.id).join(', ') || 'none'}`
    )

    return {
      capabilities: this.capabilities || {},
      authMethods: this.authMethods,
      agentName: this.agentName,
      agentVersion: this.agentVersion
    }
  }

  /** Authenticate with the agent */
  async authenticate(method: string, credentials?: Record<string, string>): Promise<void> {
    await this.sendRequest('authenticate', { method, ...credentials })
  }

  /** Create a new session */
  async newSession(workingDirectory: string): Promise<string> {
    const result = (await this.sendRequest('session/new', {
      workingDirectory
    })) as { sessionId: string }
    return result.sessionId
  }

  /** Send a prompt to a session */
  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    const result = (await this.sendRequest('session/prompt', {
      sessionId,
      prompt: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text }]
          }
        ]
      }
    })) as { stopReason: string }
    return result
  }

  /** Cancel a running prompt */
  async cancel(sessionId: string): Promise<void> {
    await this.sendRequest('session/cancel', { sessionId })
  }

  /** Resolve a pending permission request */
  resolvePermission(response: PermissionResponse): void {
    const resolver = this.permissionResolvers.get(response.requestId)
    if (resolver) {
      resolver(response)
      this.permissionResolvers.delete(response.requestId)
    }
  }

  /** Terminate the agent process */
  terminate(): void {
    if (this.childProcess) {
      this.childProcess.kill('SIGTERM')
      setTimeout(() => {
        if (this.childProcess && !this.childProcess.killed) {
          this.childProcess.kill('SIGKILL')
        }
      }, 5000)
    }
    this.rejectAllPending(new Error('Agent terminated'))
  }

  get pid(): number | undefined {
    return this.childProcess?.pid
  }

  get isRunning(): boolean {
    return this.childProcess !== null && !this.childProcess.killed
  }

  // ============================
  // Private: JSON-RPC transport
  // ============================

  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.childProcess || !this.childProcess.stdin) {
        return reject(new Error('Agent process not running'))
      }

      const id = this.nextId++
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      }

      this.pendingRequests.set(id, { resolve, reject })

      const json = JSON.stringify(request) + '\n'
      logger.debug(`[${this.agentId}:send] ${method} (id=${id})`)
      this.childProcess.stdin.write(json)
    })
  }

  private sendResponse(id: number, result: unknown): void {
    if (!this.childProcess || !this.childProcess.stdin) return

    const response = {
      jsonrpc: '2.0',
      id,
      result
    }

    this.childProcess.stdin.write(JSON.stringify(response) + '\n')
  }

  private sendError(id: number, code: number, message: string): void {
    if (!this.childProcess || !this.childProcess.stdin) return

    const response = {
      jsonrpc: '2.0',
      id,
      error: { code, message }
    }

    this.childProcess.stdin.write(JSON.stringify(response) + '\n')
  }

  private handleData(data: string): void {
    this.buffer += data
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse
        this.handleMessage(msg)
      } catch (err) {
        logger.debug(`[${this.agentId}] Non-JSON output: ${trimmed}`)
      }
    }
  }

  private handleMessage(msg: JsonRpcResponse): void {
    // Response to our request
    if (msg.id !== undefined && !msg.method) {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        this.pendingRequests.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(`ACP error ${msg.error.code}: ${msg.error.message}`))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    // Notification from agent (no id) or request from agent (has id + method)
    if (msg.method) {
      this.handleAgentMethodCall(msg)
    }
  }

  private handleAgentMethodCall(msg: JsonRpcResponse): void {
    const method = msg.method!
    const params = (msg.params || {}) as Record<string, unknown>
    const id = msg.id

    switch (method) {
      case 'session/update':
        this.handleSessionUpdate(params)
        break

      case 'session/request_permission':
        this.handlePermissionRequest(id, params)
        break

      case 'fs/read_text_file':
        this.handleReadFile(id!, params)
        break

      case 'fs/write_text_file':
        this.handleWriteFile(id!, params)
        break

      case 'terminal/create':
        this.handleTerminalCreate(id!, params)
        break

      default:
        logger.warn(`Unknown agent method: ${method}`)
        if (id !== undefined) {
          this.sendError(id, -32601, `Method not found: ${method}`)
        }
    }
  }

  // ============================
  // Agent callback handlers
  // ============================

  private handleSessionUpdate(params: Record<string, unknown>): void {
    const sessionId = params.sessionId as string
    const sessionUpdate = params.sessionUpdate as Record<string, unknown> | undefined
    const update = sessionUpdate || params

    // Transform to our SessionUpdate format
    const event: SessionUpdateEvent = {
      sessionId,
      update: this.transformSessionUpdate(update)
    }

    // Forward to renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('session:update', event)
    }
  }

  private transformSessionUpdate(raw: Record<string, unknown>): SessionUpdateEvent['update'] {
    const type = raw.type as string

    switch (type) {
      case 'agent_message_chunk':
        return {
          type: 'text_chunk',
          messageId: (raw.messageId as string) || 'current',
          text: ((raw.content as Record<string, unknown>)?.text as string) || (raw.text as string) || ''
        }

      case 'agent_thought_chunk':
        return {
          type: 'thinking_chunk',
          messageId: (raw.messageId as string) || 'current',
          text: ((raw.content as Record<string, unknown>)?.text as string) || (raw.text as string) || ''
        }

      case 'tool_call':
        return {
          type: 'tool_call_start',
          messageId: (raw.messageId as string) || 'current',
          toolCall: {
            toolCallId: (raw.toolCall as Record<string, unknown>)?.id as string || uuid(),
            title: (raw.toolCall as Record<string, unknown>)?.name as string || 'Tool Call',
            name: (raw.toolCall as Record<string, unknown>)?.name as string || 'unknown',
            status: 'running',
            input: JSON.stringify((raw.toolCall as Record<string, unknown>)?.input)
          }
        }

      case 'tool_call_status_update':
        return {
          type: 'tool_call_update',
          toolCallId: (raw.toolUseId as string) || (raw.toolCallId as string) || '',
          status: (raw.status as 'completed' | 'failed') || 'completed',
          output: raw.output as string
        }

      case 'agent_response_complete':
        return {
          type: 'message_complete',
          messageId: (raw.messageId as string) || 'current',
          stopReason: (raw.stopReason as 'end_turn') || 'end_turn'
        }

      default:
        // Pass through as text chunk for unrecognized update types
        return {
          type: 'text_chunk',
          messageId: 'current',
          text: ''
        }
    }
  }

  private async handlePermissionRequest(
    id: number | undefined,
    params: Record<string, unknown>
  ): Promise<void> {
    const requestId = uuid()

    const event: PermissionRequestEvent = {
      sessionId: params.sessionId as string || '',
      requestId,
      title: (params.title as string) || 'Permission Required',
      description: (params.description as string) || '',
      allowAlways: params.allowAlways as boolean
    }

    // Forward to renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('session:permission-request', event)
    }

    // Wait for user response
    const response = await new Promise<PermissionResponse>((resolve) => {
      this.permissionResolvers.set(requestId, resolve)

      // Timeout after 5 minutes - deny by default
      setTimeout(() => {
        if (this.permissionResolvers.has(requestId)) {
          this.permissionResolvers.delete(requestId)
          resolve({ requestId, approved: false })
        }
      }, 5 * 60 * 1000)
    })

    // Send response back to agent
    if (id !== undefined) {
      this.sendResponse(id, { approved: response.approved })
    }
  }

  private handleReadFile(id: number, params: Record<string, unknown>): void {
    const filePath = params.path as string
    try {
      const resolvedPath = path.resolve(this.cwd, filePath)
      const content = fs.readFileSync(resolvedPath, 'utf-8')
      this.sendResponse(id, { content })
    } catch (err) {
      this.sendError(id, -32002, `File not found: ${filePath}`)
    }
  }

  private handleWriteFile(id: number, params: Record<string, unknown>): void {
    const filePath = params.path as string
    const content = (params.content || params.text) as string
    try {
      const resolvedPath = path.resolve(this.cwd, filePath)
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
      fs.writeFileSync(resolvedPath, content, 'utf-8')
      this.sendResponse(id, {})
    } catch (err) {
      this.sendError(id, -32000, `Write failed: ${(err as Error).message}`)
    }
  }

  private handleTerminalCreate(id: number, params: Record<string, unknown>): void {
    // Return a terminal ID - actual PTY creation is handled by TerminalService
    const terminalId = uuid()
    this.sendResponse(id, { terminalId })
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }
}
