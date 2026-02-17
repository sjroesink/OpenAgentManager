import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { BrowserWindow } from 'electron'
import { ACP_PROTOCOL_VERSION, CLIENT_INFO } from '@shared/constants'
import type {
  AgentCapabilities,
  AuthMethod,
  AgentModelCatalog,
  AgentModelInfo,
  AgentModeCatalog,
  AgentModeInfo
} from '@shared/types/agent'
import type {
  SessionUpdateEvent,
  PermissionRequestEvent,
  PermissionResponse,
  PermissionOption,
  InteractionMode,
  ToolCallKind,
  ToolCallLocation,
  ToolCallStatus,
  ContentBlock,
  StopReason
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

interface RequestMetadata {
  method: string
  internalSessionId?: string
}

type PermissionResolver = (response: PermissionResponse) => void

interface TerminalProcess {
  process: ChildProcess
  output: string
  truncated: boolean
  exitCode: number | null
  exitSignal: string | null
  exited: boolean
  outputByteLimit: number
  waitResolvers: Array<() => void>
}

export class AcpClient extends EventEmitter {
  readonly connectionId: string
  private childProcess: ChildProcess | null = null
  private nextId = 1
  private pendingRequests = new Map<number, PendingRequest>()
  private requestMetadata = new Map<number, RequestMetadata>()
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private mainWindow: BrowserWindow | null = null
  private permissionResolvers = new Map<string, PermissionResolver>()
  private terminals = new Map<string, TerminalProcess>()

  // Session mapping: remoteId <-> internalId
  private remoteToInternal = new Map<string, string>()
  private internalToRemote = new Map<string, string>()

  // Public state
  capabilities: AgentCapabilities | null = null
  authMethods: AuthMethod[] = []
  agentName = 'Unknown Agent'
  agentVersion = ''
  private modelCatalog: AgentModelCatalog = { availableModels: [] }
  private modeCatalog: AgentModeCatalog = { availableModes: [] }

  constructor(
    public readonly agentId: string,
    private spawnCommand: string,
    private spawnArgs: string[],
    private spawnEnv: Record<string, string>,
    private cwd: string,
    private useWsl: boolean = false
  ) {
    super()
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
      // WSL: don't use shell wrapping — wsl.exe handles it via bash -ic
      // Native Windows: use shell so .cmd files resolve correctly
      shell: process.platform === 'win32' && !this.useWsl
    })

    // Handle stdout (JSON-RPC messages from agent)
    this.childProcess.stdout!.on('data', (data: Buffer) => {
      this.handleData(data.toString(), 'stdout')
    })

    // Log stderr and collect for error reporting
    const stderrChunks: string[] = []
    this.childProcess.stderr!.on('data', (data: Buffer) => {
      const raw = data.toString()
      const text = raw.trim()
      if (text) {
        stderrChunks.push(text)
        logger.warn(`[${this.agentId}:stderr] ${text}`)
        // Try parsing as JSON-RPC (some agents write to stderr)
        this.handleData(raw, 'stderr')
      }
    })

    this.childProcess.on('exit', (code, signal) => {
      logger.info(`Agent ${this.agentId} exited: code=${code}, signal=${signal}`)
      const stderr = stderrChunks.join('\n')
      const msg = stderr
        ? `Agent process exited: code=${code}\n${stderr}`
        : `Agent process exited: code=${code}`
      this.rejectAllPending(new Error(msg))
    })

    this.childProcess.on('error', (err) => {
      logger.error(`Agent ${this.agentId} spawn error:`, err)
      this.rejectAllPending(err)
    })
  }

  /** Initialize the ACP connection */
  async initialize(timeoutMs: number = 30000): Promise<{
    capabilities: AgentCapabilities
    authMethods: AuthMethod[]
    agentName: string
    agentVersion: string
  }> {
    const result = await this.sendRequestWithTimeout('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: {
        name: CLIENT_INFO.name,
        title: CLIENT_INFO.title,
        version: CLIENT_INFO.version
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true
        },
        terminal: true
      }
    }, timeoutMs) as {
      protocolVersion?: number
      agentInfo?: { name: string; title?: string; version: string }
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
    await this.sendRequest('authenticate', { methodId: method, ...credentials })
  }

  /** Create a new session */
  async newSession(
    cwd: string,
    mcpServers: unknown[] = [],
    internalSessionId?: string,
    options?: { suppressInitialUpdates?: boolean; preferredModeId?: string }
  ): Promise<string> {
    const result = (await this.sendRequest(
      'session/new',
      {
        cwd,
        mcpServers
      },
      { internalSessionId }
    )) as {
      sessionId: string
      modes?: {
        currentModeId?: string
        availableModes?: Array<{ id: string; name: string; description?: string }>
      }
      models?: {
        currentModelId?: string
        availableModels?: Array<{ modelId: string; name: string; description?: string }>
      }
      configOptions?: Array<Record<string, unknown>>
    }
    const remoteId = result.sessionId
    const suppressInitialUpdates = options?.suppressInitialUpdates === true
    const preferredModeId = options?.preferredModeId
    this.updateModelCatalogFromSessionNewResult(result)
    this.updateModeCatalogFromSessionNewResult(result)

    if (internalSessionId) {
      this.registerSessionMapping(remoteId, internalSessionId)
    }

    const sessionId = internalSessionId || remoteId

    // Forward initial modes and configOptions from session/new response as updates
    if (!suppressInitialUpdates && result.modes) {
      const modes = result.modes
      // Build configOptions from legacy modes field for backward compat
      if (modes.availableModes && modes.availableModes.length > 0) {
        const resolvedModeId =
          preferredModeId && modes.availableModes.some((mode) => mode.id === preferredModeId)
            ? preferredModeId
            : modes.currentModeId || modes.availableModes[0].id
        const modeConfigOption = {
          id: '_mode',
          name: 'Mode',
          category: 'mode' as const,
          type: 'select' as const,
          currentValue: resolvedModeId,
          options: modes.availableModes.map((m) => ({
            value: m.id,
            name: m.name,
            description: m.description
          }))
        }

        // Only emit if there are no configOptions with category 'mode' already
        const existingModeConfig = result.configOptions?.find(
          (opt) => (opt.category as string) === 'mode'
        )
        if (!existingModeConfig) {
          const event: SessionUpdateEvent = {
            sessionId,
            update: { type: 'config_options_update', options: [modeConfigOption] }
          }
          this.emit('session-update', event)
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('session:update', event)
          }
        }

        // Also emit current_mode_update
        if (resolvedModeId) {
          const modeEvent: SessionUpdateEvent = {
            sessionId,
            update: { type: 'current_mode_update', modeId: resolvedModeId }
          }
          this.emit('session-update', modeEvent)
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('session:update', modeEvent)
          }
        }
      }
    }

    // Forward initial models from session/new response as config option
    if (!suppressInitialUpdates && result.models) {
      const models = result.models
      if (models.availableModels && models.availableModels.length > 0) {
        const existingModelConfig = result.configOptions?.find(
          (opt) => (opt.category as string) === 'model'
        )
        if (!existingModelConfig) {
          const modelConfigOption = {
            id: '_model',
            name: 'Model',
            category: 'model' as const,
            type: 'select' as const,
            currentValue: models.currentModelId || models.availableModels[0].modelId,
            options: models.availableModels.map((m) => ({
              value: m.modelId,
              name: m.name,
              description: m.description
            }))
          }
          const event: SessionUpdateEvent = {
            sessionId,
            update: { type: 'config_options_update', options: [modelConfigOption] }
          }
          this.emit('session-update', event)
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('session:update', event)
          }
        }
      }
    }

    if (!suppressInitialUpdates && result.configOptions && result.configOptions.length > 0) {
      const options = result.configOptions.map((opt) => ({
        id: (opt.id as string) || '',
        name: (opt.name as string) || '',
        description: opt.description as string | undefined,
        category: opt.category as string | undefined,
        type: 'select' as const,
        currentValue: (opt.currentValue as string) || '',
        options: ((opt.options as Array<Record<string, unknown>>) || []).map((v) => ({
          value: (v.value as string) || '',
          name: (v.name as string) || '',
          description: v.description as string | undefined
        }))
      }))

      // Merge with any modes-derived configOptions
      const event: SessionUpdateEvent = {
        sessionId,
        update: { type: 'config_options_update', options }
      }
      this.emit('session-update', event)
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('session:update', event)
      }
    }

    return sessionId
  }

  getModelCatalog(): AgentModelCatalog {
    return {
      currentModelId: this.modelCatalog.currentModelId,
      availableModels: [...this.modelCatalog.availableModels]
    }
  }

  getModeCatalog(): AgentModeCatalog {
    return {
      currentModeId: this.modeCatalog.currentModeId,
      availableModes: [...this.modeCatalog.availableModes]
    }
  }

  private updateModelCatalogFromSessionNewResult(result: {
    models?: {
      currentModelId?: string
      availableModels?: Array<{ modelId: string; name: string; description?: string }>
    }
    configOptions?: Array<Record<string, unknown>>
  }): void {
    if (result.models?.availableModels && result.models.availableModels.length > 0) {
      this.modelCatalog = {
        currentModelId: result.models.currentModelId,
        availableModels: result.models.availableModels.map((m) => ({
          modelId: m.modelId,
          name: m.name,
          description: m.description
        }))
      }
      return
    }

    const modelConfig = result.configOptions?.find((opt) => (opt.category as string) === 'model')
    if (!modelConfig) return

    const configOptions = ((modelConfig.options as Array<Record<string, unknown>>) || [])
      .map((option): AgentModelInfo | null => {
        const modelId = option.value as string | undefined
        const name = option.name as string | undefined
        if (!modelId || !name) return null
        return {
          modelId,
          name,
          description: option.description as string | undefined
        }
      })
      .filter((option): option is AgentModelInfo => option !== null)

    if (configOptions.length > 0) {
      this.modelCatalog = {
        currentModelId: modelConfig.currentValue as string | undefined,
        availableModels: configOptions
      }
    }
  }

  private updateModeCatalogFromSessionNewResult(result: {
    modes?: {
      currentModeId?: string
      availableModes?: Array<{ id: string; name: string; description?: string }>
    }
    configOptions?: Array<Record<string, unknown>>
  }): void {
    if (result.modes?.availableModes && result.modes.availableModes.length > 0) {
      this.modeCatalog = {
        currentModeId: result.modes.currentModeId,
        availableModes: result.modes.availableModes.map((m) => ({
          modeId: m.id,
          name: m.name,
          description: m.description
        }))
      }
      return
    }

    const modeConfig = result.configOptions?.find((opt) => (opt.category as string) === 'mode')
    if (!modeConfig) return

    const configOptions = ((modeConfig.options as Array<Record<string, unknown>>) || [])
      .map((option): AgentModeInfo | null => {
        const modeId = option.value as string | undefined
        const name = option.name as string | undefined
        if (!modeId || !name) return null
        return {
          modeId,
          name,
          description: option.description as string | undefined
        }
      })
      .filter((option): option is AgentModeInfo => option !== null)

    if (configOptions.length > 0) {
      this.modeCatalog = {
        currentModeId: modeConfig.currentValue as string | undefined,
        availableModes: configOptions
      }
    }
  }

  /** Fork an existing session (RFD: session/fork) */
  async forkSession(
    sourceSessionId: string,
    cwd: string,
    mcpServers: unknown[] = [],
    internalSessionId?: string
  ): Promise<string> {
    const remoteId = this.internalToRemote.get(sourceSessionId) || sourceSessionId
    const params: Record<string, unknown> = { sessionId: remoteId, cwd }
    if (mcpServers.length > 0) params.mcpServers = mcpServers

    const result = (await this.sendRequest('session/fork', params)) as { sessionId: string }
    const newRemoteId = result.sessionId

    if (internalSessionId) {
      this.remoteToInternal.set(newRemoteId, internalSessionId)
      this.internalToRemote.set(internalSessionId, newRemoteId)
      return internalSessionId
    }

    return newRemoteId
  }

  /** Check if the connected agent supports session/fork */
  get supportsFork(): boolean {
    return !!this.capabilities?.sessionCapabilities?.fork
  }

  /** Send a prompt to a session (spec: prompt is ContentBlock[]) */
  async prompt(
    sessionId: string,
    content: ContentBlock[] | string,
    mode?: InteractionMode
  ): Promise<{ stopReason: string }> {
    const remoteId = this.internalToRemote.get(sessionId) || sessionId
    // Normalize: accept string for backwards compat, always send ContentBlock[]
    const promptBlocks: ContentBlock[] =
      typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : content
    const params: Record<string, unknown> = {
      sessionId: remoteId,
      prompt: promptBlocks
    }
    if (mode) {
      params.interactionMode = mode
    }
    return (await this.sendRequest('session/prompt', params)) as { stopReason: string }
  }

  /** Set the session mode (spec: session/set_mode) */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const remoteId = this.internalToRemote.get(sessionId) || sessionId
    await this.sendRequest('session/set_mode', { sessionId: remoteId, modeId })
  }

  /** Set the session model (spec: session/set_model) */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const remoteId = this.internalToRemote.get(sessionId) || sessionId
    await this.sendRequest('session/set_model', { sessionId: remoteId, modelId })
  }

  /** Set a config option value (spec: session/set_config_option) */
  async setConfigOption(sessionId: string, configId: string, value: string): Promise<unknown> {
    const remoteId = this.internalToRemote.get(sessionId) || sessionId
    return await this.sendRequest('session/set_config_option', {
      sessionId: remoteId,
      configId,
      value
    })
  }

  /** Load an existing session (spec: session/load) */
  async loadSession(sessionId: string, cwd: string, mcpServers: unknown[] = []): Promise<void> {
    const remoteId = this.internalToRemote.get(sessionId) || sessionId
    await this.sendRequest('session/load', {
      sessionId: remoteId,
      cwd,
      mcpServers
    })
  }

  /** Cancel a running prompt (ACP spec: notification, not request) */
  cancel(sessionId: string): void {
    const remoteId = this.internalToRemote.get(sessionId) || sessionId
    this.sendNotification('session/cancel', { sessionId: remoteId })
  }

  /** Cancel a specific pending request (RFD: $/cancel_request) */
  cancelRequest(requestId: number | string): void {
    this.sendNotification('$/cancel_request', { requestId })
  }

  /** Logout - invalidate credentials (RFD) */
  async logout(): Promise<void> {
    await this.sendRequest('logout', {})
  }

  /** Resolve a pending permission request */
  resolvePermission(response: PermissionResponse): void {
    logger.info(`[${this.agentId}] resolvePermission: requestId=${response.requestId}, optionId=${response.optionId}, hasPending=${this.permissionResolvers.has(response.requestId)}`)
    const resolver = this.permissionResolvers.get(response.requestId)
    if (resolver) {
      // safeResolve handles deletion and double-call protection
      resolver(response)
    } else {
      logger.warn(`[${this.agentId}] No pending resolver for requestId=${response.requestId}`)
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

  private async sendRequest(
    method: string,
    params?: unknown,
    metadata?: { internalSessionId?: string }
  ): Promise<unknown> {
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
      this.requestMetadata.set(id, {
        method,
        internalSessionId: metadata?.internalSessionId
      })

      const json = JSON.stringify(request) + '\n'
      logger.info(`[${this.agentId}:send] ${json.trim()}`)
      this.childProcess.stdin.write(json)
    })
  }

  private async sendRequestWithTimeout(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
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

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        this.requestMetadata.delete(id)
        reject(new Error(`Request '${method}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        }
      })
      this.requestMetadata.set(id, { method })

      const json = JSON.stringify(request) + '\n'
      logger.info(`[${this.agentId}:send] ${json.trim()}`)
      this.childProcess.stdin.write(json)
    })
  }

  /** Send a one-way JSON-RPC notification (no id, no response expected) */
  private sendNotification(method: string, params?: unknown): void {
    if (!this.childProcess || !this.childProcess.stdin) return
    const notification = { jsonrpc: '2.0', method, params }
    const json = JSON.stringify(notification) + '\n'
    logger.info(`[${this.agentId}:send] ${json.trim()}`)
    this.childProcess.stdin.write(json)
  }

  private sendResponse(id: any, result: unknown): void {
    if (!this.childProcess || !this.childProcess.stdin) return

    const response = {
      jsonrpc: '2.0',
      id,
      result
    }

    const json = JSON.stringify(response) + '\n'
    logger.info(`[${this.agentId}:send] ${json.trim()}`)
    this.childProcess.stdin.write(json)
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

  private handleData(data: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    const isStdout = stream === 'stdout'
    const currentBuffer = (isStdout ? this.stdoutBuffer : this.stderrBuffer) + data
    const lines = currentBuffer.split('\n')
    const remaining = lines.pop() || ''

    if (isStdout) {
      this.stdoutBuffer = remaining
    } else {
      this.stderrBuffer = remaining
    }

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse
        this.handleMessage(msg)
      } catch {
        logger.debug(`[${this.agentId}] Non-JSON output (${stream}): ${trimmed}`)
      }
    }
  }

  private handleMessage(msg: any): void {
    // Log all incoming messages
    logger.info(`[${this.agentId}:recv] ${JSON.stringify(msg)}`)

    // Response to our request
    if (msg.id !== undefined && msg.method === undefined) {
      const responseId = Number(msg.id)
      const pending = this.pendingRequests.get(responseId)
      const metadata = this.requestMetadata.get(responseId)
      if (pending) {
        if (!msg.error && metadata?.method === 'session/new' && metadata.internalSessionId) {
          const result = msg.result as { sessionId?: unknown } | undefined
          const remoteId = typeof result?.sessionId === 'string' ? result.sessionId : ''
          if (remoteId) {
            this.registerSessionMapping(remoteId, metadata.internalSessionId)
          }
        }
        this.pendingRequests.delete(responseId)
        this.requestMetadata.delete(responseId)
        if (msg.error) {
          pending.reject(new Error(`ACP error ${msg.error.code}: ${msg.error.message}${msg.error.data ? ' | data: ' + JSON.stringify(msg.error.data) : ''}`))
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

      case 'terminal/output':
        this.handleTerminalOutput(id!, params)
        break

      case 'terminal/wait_for_exit':
        this.handleTerminalWaitForExit(id!, params)
        break

      case 'terminal/kill':
        this.handleTerminalKill(id!, params)
        break

      case 'terminal/release':
        this.handleTerminalRelease(id!, params)
        break

      case '$/cancel_request': {
        // RFD: agent cancels a request it sent us
        const requestId = params.requestId as number
        const pending = this.pendingRequests.get(requestId)
        if (pending) {
          this.pendingRequests.delete(requestId)
          this.requestMetadata.delete(requestId)
          pending.reject(new Error('Request cancelled by agent (code -32800)'))
        }
        break
      }

      default:
        // Ignore unknown notifications (prefix with _ or $/)
        if (method.startsWith('_') || method.startsWith('$/')) {
          logger.debug(`Ignoring unknown extension method: ${method}`)
        } else {
          logger.warn(`Unknown agent method: ${method}`)
          if (id !== undefined) {
            this.sendError(id, -32601, `Method not found: ${method}`)
          }
        }
    }
  }

  // ============================
  // Agent callback handlers
  // ============================

  private handleSessionUpdate(params: Record<string, unknown>): void {
    const remoteId = params.sessionId as string
    const internalId = this.remoteToInternal.get(remoteId) || remoteId

    // ACP session/update notification structure:
    // { sessionId, update: { sessionUpdate: "agent_message_chunk", content: {...}, ... } }
    const update = params.update as Record<string, unknown> | undefined

    if (!update) {
      logger.warn(`Session update missing 'update' field: ${JSON.stringify(params)}`)
      return
    }

    try {
      // Transform to our SessionUpdate format
      const sessionUpdate = this.transformSessionUpdate(update)
      const event: SessionUpdateEvent = {
        sessionId: internalId,
        update: sessionUpdate
      }

      // Emit for SessionManagerService
      this.emit('session-update', event)

      // Forward to renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('session:update', event)
      }
    } catch (err) {
      logger.error(`Error transforming session update:`, err)
    }
  }

  private extractText(raw: Record<string, unknown>): string {
    // ACP agents send text content in various shapes; try common patterns
    const content = raw.content as Record<string, unknown> | string | undefined
    if (typeof content === 'string') return content
    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') return content.text
      if (typeof content.data === 'string') return content.data
      if (typeof content.value === 'string') return content.value
    }
    // Fallback: check top-level text/data fields
    if (typeof raw.text === 'string') return raw.text
    if (typeof raw.data === 'string') return raw.data
    return ''
  }

  private transformSessionUpdate(raw: Record<string, unknown>): SessionUpdateEvent['update'] {
    // ACP uses 'sessionUpdate' as the discriminator field, not 'type'
    const updateType = raw.sessionUpdate as string

    switch (updateType) {
      case 'agent_message_start': {
        return {
          type: 'message_start',
          messageId: (raw.messageId as string) || 'current'
        }
      }

      case 'agent_message_chunk': {
        const text = this.extractText(raw)
        // Skip empty chunks to avoid creating empty bubbles
        if (!text) {
          return { type: 'text_chunk', messageId: (raw.messageId as string) || 'current', text: '' }
        }
        return {
          type: 'text_chunk',
          messageId: (raw.messageId as string) || 'current',
          text
        }
      }

      case 'agent_thought_chunk': {
        return {
          type: 'thinking_chunk',
          messageId: (raw.messageId as string) || 'current',
          text: this.extractText(raw)
        }
      }

      case 'agent_message_complete':
      case 'message_complete': {
        return {
          type: 'message_complete',
          messageId: (raw.messageId as string) || 'current',
          stopReason: (raw.stopReason as StopReason) || 'end_turn'
        }
      }

      case 'tool_call': {
        const toolCallId = (raw.toolCallId as string) || uuid()
        const rawInput = raw.rawInput || raw.input
        const contentArr = raw.content as Array<Record<string, unknown>> | undefined
        // Extract diff from content array if present
        let diff: { path: string; oldText: string; newText: string } | undefined
        if (Array.isArray(contentArr)) {
          const diffBlock = contentArr.find((c) => c.type === 'diff')
          if (diffBlock) {
            diff = {
              path: (diffBlock.path as string) || '',
              oldText: (diffBlock.oldText as string) || '',
              newText: (diffBlock.newText as string) || ''
            }
          }
        }
        // Extract tool name from _meta if available
        const meta = raw._meta as Record<string, Record<string, string>> | undefined
        const toolName = meta?.claudeCode?.toolName || (raw.title as string) || 'unknown'

        // ACP spec: kind categorizes the tool type
        const kind = (raw.kind as ToolCallKind) || undefined

        // ACP spec: locations for file-following
        const locations = raw.locations as ToolCallLocation[] | undefined

        return {
          type: 'tool_call_start',
          messageId: (raw.messageId as string) || 'current',
          toolCall: {
            toolCallId,
            title: (raw.title as string) || 'Tool Call',
            name: toolName,
            kind,
            status: (raw.status as ToolCallStatus) || 'pending',
            input: rawInput ? JSON.stringify(rawInput) : undefined,
            rawInput,
            locations,
            ...(diff ? { diff } : {})
          }
        }
      }

      case 'tool_call_update': {
        const rawOutput = raw.rawOutput || raw.output
        const locations = raw.locations as ToolCallLocation[] | undefined
        const toolCallObj = raw.toolCall as Record<string, unknown> | undefined
        const resolvedToolCallId =
          (raw.toolCallId as string) ||
          (toolCallObj?.toolCallId as string) ||
          (raw.id as string) ||
          ''
        return {
          type: 'tool_call_update',
          toolCallId: resolvedToolCallId,
          status: (raw.status as ToolCallStatus) || 'completed',
          output: typeof rawOutput === 'string' ? rawOutput : (rawOutput != null ? JSON.stringify(rawOutput) : undefined),
          locations
        }
      }

      case 'plan': {
        // ACP spec: plan entries with content, priority, status
        const entries = (raw.entries as Array<Record<string, unknown>>) || []
        return {
          type: 'plan_update',
          entries: entries.map((e) => ({
            content: (e.content as string) || '',
            priority: (e.priority as 'high' | 'medium' | 'low') || 'medium',
            status: (e.status as 'pending' | 'in_progress' | 'completed') || 'pending'
          }))
        }
      }

      case 'current_mode_update': {
        return {
          type: 'current_mode_update',
          modeId: (raw.modeId as string) || ''
        }
      }

      case 'config_options_update': {
        const options = (raw.options as Array<Record<string, unknown>>) || []
        return {
          type: 'config_options_update',
          options: options.map((opt) => ({
            id: (opt.id as string) || '',
            name: (opt.name as string) || '',
            description: opt.description as string | undefined,
            category: opt.category as string | undefined,
            type: 'select' as const,
            currentValue: (opt.currentValue as string) || '',
            options: ((opt.options as Array<Record<string, unknown>>) || []).map((v) => ({
              value: (v.value as string) || '',
              name: (v.name as string) || '',
              description: v.description as string | undefined
            }))
          }))
        }
      }

      case 'available_commands_update': {
        const commands = (raw.availableCommands as Array<Record<string, unknown>>) || (raw.commands as Array<Record<string, unknown>>) || []
        return {
          type: 'available_commands_update',
          commands: commands.map((cmd) => ({
            name: (cmd.name as string) || '',
            description: (cmd.description as string) || '',
            input: cmd.input as { hint: string } | undefined
          }))
        }
      }

      case 'session_info_update': {
        // RFD: agent dynamically updates session metadata
        return {
          type: 'session_info_update',
          title: raw.title as string | null | undefined,
          updatedAt: raw.updatedAt as string | null | undefined,
          _meta: raw._meta as Record<string, unknown> | null | undefined
        }
      }

      case 'usage_update': {
        // RFD: token/context/cost tracking
        return {
          type: 'usage_update',
          usage: {
            used: (raw.used as number) || 0,
            size: (raw.size as number) || 0,
            cost: raw.cost as { amount: number; currency: string } | undefined
          }
        }
      }

      case 'user_message_chunk':
        // History replay during session/load — ignore for now
        return { type: 'text_chunk', messageId: 'current', text: '' }

      default:
        logger.debug(`Unhandled session update type: ${updateType}`)
        return { type: 'text_chunk', messageId: 'current', text: '' }
    }
  }

  private async handlePermissionRequest(
    id: any,
    params: Record<string, unknown>
  ): Promise<void> {
    const requestId = uuid()
    // Dump full params for debugging
    logger.info(`[${this.agentId}] handlePermissionRequest params: ${JSON.stringify(params)}`)

    // Try multiple possible paths for sessionId
    const remoteSessionId = (params.sessionId || (params._meta as any)?.sessionId || params.sid) as string
    const internalSessionId = this.remoteToInternal.get(remoteSessionId) || remoteSessionId
    
    logger.info(`[${this.agentId}] handlePermissionRequest: rpcId=${id}, requestId=${requestId}, sessionId=${remoteSessionId} (internal=${internalSessionId})`)

    try {
      // Extract toolCall from ACP schema
      const toolCallRaw = (params.toolCall || {}) as Record<string, unknown>
      const toolCallId = (toolCallRaw.toolCallId || params.toolCallId) as string
      const toolCall = {
        toolCallId: toolCallId || '',
        title: (toolCallRaw.title || params.title) as string | undefined,
        kind: (toolCallRaw.kind || params.kind) as string | undefined,
        rawInput: toolCallRaw.rawInput || toolCallRaw.input || params.input
      }

      // Extract options from ACP schema
      const optionsRaw = (params.options || []) as Array<Record<string, unknown>>
      const options: PermissionOption[] = optionsRaw.map((opt) => ({
        optionId: (opt.optionId as string) || '',
        name: (opt.name as string) || '',
        kind: ((opt.kind as string) || 'allow_once') as PermissionOption['kind']
      }))

      // Fallback: if no options provided, create default allow/deny
      if (options.length === 0) {
        options.push(
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' }
        )
      }

      const event: PermissionRequestEvent = {
        sessionId: internalSessionId,
        requestId,
        toolCall,
        options
      }

      // Setup resolver BEFORE sending to renderer to avoid race conditions
      const responsePromise = new Promise<PermissionResponse>((resolve) => {
        let settled = false
        const safeResolve = (response: PermissionResponse): void => {
          if (settled) return
          settled = true
          this.permissionResolvers.delete(requestId)
          resolve(response)
        }
        this.permissionResolvers.set(requestId, safeResolve)

        // Timeout after 5 minutes - cancel by default
        setTimeout(() => {
          logger.warn(`[${this.agentId}] Permission request ${requestId} timed out.`)
          safeResolve({ requestId, optionId: '__cancelled__' })
        }, 5 * 60 * 1000)
      })

      // Emit for SessionManager permission tracking
      this.emit('permission-request', event)

      // Forward to renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('session:permission-request', event)
      } else {
        logger.warn(`[${this.agentId}] Cannot send permission request: mainWindow not available`)
      }

      // Wait for user response
      const response = await responsePromise

      // Send response back to agent
      if (id !== undefined) {
        logger.info(`[${this.agentId}] Sending permission response for ${requestId}: ${response.optionId}`)

        // ACP spec: RequestPermissionResponse = { outcome: RequestPermissionOutcome }
        // RequestPermissionOutcome = { outcome: "cancelled" } | { outcome: "selected", optionId: string }
        // "cancelled" = prompt turn cancelled before user responded (timeout/disconnect)
        // "selected" = user made a choice (allow OR reject — both are selections)
        const responseResult: Record<string, any> = {
          outcome: response.optionId === '__cancelled__'
            ? { outcome: 'cancelled' }
            : { outcome: 'selected', optionId: response.optionId }
        }

        this.sendResponse(id, responseResult)
      }
    } catch (err) {
      logger.error(`[${this.agentId}] Error handling permission request:`, err)
      if (id !== undefined) {
        this.sendError(id, -32603, `Internal error handling permission: ${(err as Error).message}`)
      }
    }
  }

  private handleReadFile(id: number, params: Record<string, unknown>): void {
    const filePath = params.path as string
    const line = params.line as number | undefined    // 1-based start line
    const limit = params.limit as number | undefined  // max lines to read
    try {
      const resolvedPath = path.resolve(this.cwd, filePath)
      let content = fs.readFileSync(resolvedPath, 'utf-8')

      // ACP spec: optional line/limit for partial reads
      if (line !== undefined || limit !== undefined) {
        const lines = content.split('\n')
        const startIdx = line ? Math.max(0, line - 1) : 0
        const endIdx = limit ? startIdx + limit : lines.length
        content = lines.slice(startIdx, endIdx).join('\n')
      }

      this.sendResponse(id, { content })
    } catch {
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

  // ============================
  // Terminal methods (ACP spec: 5 methods)
  // ============================

  private handleTerminalCreate(id: number, params: Record<string, unknown>): void {
    const terminalId = uuid()
    const command = params.command as string
    const args = (params.args as string[]) || []
    const env = params.env as Array<{ name: string; value: string }> | undefined
    const termCwd = (params.cwd as string) || this.cwd
    const outputByteLimit = (params.outputByteLimit as number) || 1024 * 1024 // 1MB default

    try {
      const envObj: Record<string, string> = { ...process.env as Record<string, string> }
      if (env) {
        for (const e of env) envObj[e.name] = e.value
      }

      const proc = spawn(command, args, {
        cwd: termCwd,
        env: envObj,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      const terminal: TerminalProcess = {
        process: proc,
        output: '',
        truncated: false,
        exitCode: null,
        exitSignal: null,
        exited: false,
        outputByteLimit,
        waitResolvers: []
      }

      const appendOutput = (data: Buffer): void => {
        const text = data.toString()
        terminal.output += text
        // Truncate from beginning if over limit
        const byteLen = Buffer.byteLength(terminal.output)
        if (byteLen > terminal.outputByteLimit) {
          terminal.output = terminal.output.slice(terminal.output.length - terminal.outputByteLimit)
          terminal.truncated = true
        }
      }

      proc.stdout?.on('data', appendOutput)
      proc.stderr?.on('data', appendOutput)
      proc.on('exit', (code, signal) => {
        terminal.exitCode = code
        terminal.exitSignal = signal
        terminal.exited = true
        for (const r of terminal.waitResolvers) r()
        terminal.waitResolvers = []
      })
      proc.on('error', (err) => {
        terminal.output += `\nError: ${err.message}\n`
        terminal.exited = true
        terminal.exitCode = 1
        for (const r of terminal.waitResolvers) r()
        terminal.waitResolvers = []
      })

      this.terminals.set(terminalId, terminal)
      this.sendResponse(id, { terminalId })
    } catch (err) {
      this.sendError(id, -32000, `Failed to create terminal: ${(err as Error).message}`)
    }
  }

  private handleTerminalOutput(id: number, params: Record<string, unknown>): void {
    const terminalId = params.terminalId as string
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      this.sendError(id, -32002, `Terminal not found: ${terminalId}`)
      return
    }

    const result: Record<string, unknown> = {
      output: terminal.output,
      truncated: terminal.truncated
    }
    if (terminal.exited) {
      result.exitStatus = { exitCode: terminal.exitCode, signal: terminal.exitSignal }
    }
    this.sendResponse(id, result)
  }

  private handleTerminalWaitForExit(id: number, params: Record<string, unknown>): void {
    const terminalId = params.terminalId as string
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      this.sendError(id, -32002, `Terminal not found: ${terminalId}`)
      return
    }

    if (terminal.exited) {
      this.sendResponse(id, { exitCode: terminal.exitCode, signal: terminal.exitSignal })
      return
    }

    terminal.waitResolvers.push(() => {
      this.sendResponse(id, { exitCode: terminal.exitCode, signal: terminal.exitSignal })
    })
  }

  private handleTerminalKill(id: number, params: Record<string, unknown>): void {
    const terminalId = params.terminalId as string
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      this.sendError(id, -32002, `Terminal not found: ${terminalId}`)
      return
    }

    if (!terminal.exited) {
      terminal.process.kill('SIGTERM')
    }
    this.sendResponse(id, {})
  }

  private handleTerminalRelease(id: number, params: Record<string, unknown>): void {
    const terminalId = params.terminalId as string
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      this.sendError(id, -32002, `Terminal not found: ${terminalId}`)
      return
    }

    if (!terminal.exited) {
      terminal.process.kill('SIGKILL')
    }
    this.terminals.delete(terminalId)
    this.sendResponse(id, {})
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
    this.requestMetadata.clear()
    // Clean up terminals
    for (const [, terminal] of this.terminals) {
      if (!terminal.exited) {
        terminal.process.kill('SIGKILL')
      }
    }
    this.terminals.clear()
  }

  private registerSessionMapping(remoteId: string, internalSessionId: string): void {
    this.remoteToInternal.set(remoteId, internalSessionId)
    this.internalToRemote.set(internalSessionId, remoteId)
  }
}
