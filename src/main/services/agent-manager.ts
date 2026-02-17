import { BrowserWindow } from 'electron'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { v4 as uuid } from 'uuid'
import type {
  AcpRegistryAgent,
  InstalledAgent,
  AgentConnection,
  AgentAuthCheckResult,
  AgentStatus,
  BinaryDistribution,
  AuthMethod,
  AgentModelCatalog,
  AgentModeCatalog
} from '@shared/types/agent'
import { getApiKeyEnvVarsForAgent, getModelArgForAgent, getModelEnvVarsForAgent } from '@shared/config/agent-env'
import { registryService } from './registry-service'
import { settingsService } from './settings-service'
import { downloadService } from './download-service'
import { AcpClient } from './acp-client'
import { getCurrentPlatformTarget, getNpxCommand, getUvxCommand, toWslPath } from '../util/platform'
import { logger } from '../util/logger'

/**
 * AgentManager handles the full agent lifecycle:
 * - Discovery (via registry)
 * - Installation (npx record / binary download)
 * - Launching (spawn child process)
 * - Connection (ACP protocol init)
 * - Termination
 */
export class AgentManagerService {
  private installed = new Map<string, InstalledAgent>()
  private connections = new Map<string, AcpClient>()
  private mainWindow: BrowserWindow | null = null

  constructor() {
    this.loadInstalled()
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    // Update existing connections
    for (const client of this.connections.values()) {
      client.setMainWindow(window)
    }
  }

  // ============================
  // Installation
  // ============================

  async install(agentId: string): Promise<InstalledAgent> {
    const registry = await registryService.fetch()
    const agent = registry.agents.find((a) => a.id === agentId)
    if (!agent) {
      throw new Error(`Agent not found in registry: ${agentId}`)
    }

    let installed: InstalledAgent

    if (agent.distribution.npx) {
      installed = this.installNpx(agent)
    } else if (agent.distribution.uvx) {
      installed = this.installUvx(agent)
    } else if (agent.distribution.binary) {
      installed = await this.installBinary(agent)
    } else {
      throw new Error(`No supported distribution method for agent: ${agentId}`)
    }

    this.installed.set(agentId, installed)
    this.saveInstalled()

    logger.info(`Agent installed: ${installed.name} (${installed.distributionType})`)
    return installed
  }

  private installNpx(agent: AcpRegistryAgent): InstalledAgent {
    return {
      registryId: agent.id,
      name: agent.name,
      version: agent.version,
      description: agent.description,
      installedAt: new Date().toISOString(),
      distributionType: 'npx',
      npxPackage: agent.distribution.npx!.package,
      icon: agent.icon,
      authors: agent.authors,
      license: agent.license
    }
  }

  private installUvx(agent: AcpRegistryAgent): InstalledAgent {
    return {
      registryId: agent.id,
      name: agent.name,
      version: agent.version,
      description: agent.description,
      installedAt: new Date().toISOString(),
      distributionType: 'uvx',
      uvxPackage: agent.distribution.uvx!.package,
      icon: agent.icon,
      authors: agent.authors,
      license: agent.license
    }
  }

  private async installBinary(agent: AcpRegistryAgent): Promise<InstalledAgent> {
    const platform = getCurrentPlatformTarget()
    if (!platform) {
      throw new Error('Unsupported platform for binary agent installation')
    }

    const binaryDist = agent.distribution.binary as BinaryDistribution
    const target = binaryDist[platform]
    if (!target) {
      throw new Error(`No binary available for platform: ${platform}`)
    }

    const executablePath = await downloadService.downloadAndExtract(
      agent.id,
      agent.version,
      target
    )

    return {
      registryId: agent.id,
      name: agent.name,
      version: agent.version,
      description: agent.description,
      installedAt: new Date().toISOString(),
      distributionType: 'binary',
      executablePath,
      icon: agent.icon,
      authors: agent.authors,
      license: agent.license
    }
  }

  uninstall(agentId: string): void {
    // Terminate any active connections first
    for (const [connId, client] of this.connections) {
      if (client.agentId === agentId) {
        client.terminate()
        this.connections.delete(connId)
      }
    }

    this.installed.delete(agentId)
    this.saveInstalled()
    logger.info(`Agent uninstalled: ${agentId}`)
  }

  listInstalled(): InstalledAgent[] {
    return Array.from(this.installed.values())
  }

  // ============================
  // Launching & Connection
  // ============================

  async launch(agentId: string, projectPath: string, extraEnv?: Record<string, string>): Promise<AgentConnection> {
    const agent = this.installed.get(agentId)
    if (!agent) {
      throw new Error(`Agent not installed: ${agentId}`)
    }

    // Get registry with fallback to fetch if cache is missing or args are needed
    let registry = registryService.getCached()
    const needsArgs = agent.distributionType === 'binary'
    
    if (!registry || (needsArgs)) {
      logger.info(`Fetching registry to resolve agent args for: ${agentId}`)
      registry = await registryService.fetch()
    }
    
    const registryAgent = registry?.agents.find((a) => a.id === agentId)

    // Resolve spawn command
    const { command, args, env } = this.resolveSpawnCommand(agent, registryAgent)

    // Get agent-specific settings
    const agentSettings = settingsService.getAgentSettings(agentId)
    const finalEnv: Record<string, string> = { ...env }

    // Add mapped API key env vars for this agent.
    for (const envVarName of getApiKeyEnvVarsForAgent(agentId)) {
      const mappedValue = this.resolveMappedApiKeyValue(agentId, agentSettings, envVarName)
      if (mappedValue) {
        finalEnv[envVarName] = mappedValue
      }
    }

    // Add mapped model env vars for this agent.
    if (agentSettings?.model) {
      for (const envVarName of getModelEnvVarsForAgent(agentId)) {
        finalEnv[envVarName] = agentSettings.model
      }
    }

    // Merge custom env
    if (agentSettings?.customEnv) {
      Object.assign(finalEnv, agentSettings.customEnv)
    }

    // Merge extra env (e.g. from env_var auth method) with blocklist
    if (extraEnv) {
      const ENV_BLOCKLIST = new Set([
        'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
        'NODE_OPTIONS', 'NODE_DEBUG', 'PATH', 'HOME', 'SHELL',
        'ELECTRON_RUN_AS_NODE', 'ELECTRON_ENABLE_LOGGING',
      ])
      for (const [key, value] of Object.entries(extraEnv)) {
        if (ENV_BLOCKLIST.has(key.toUpperCase())) {
          logger.warn(`Blocked dangerous environment variable: ${key}`)
          continue
        }
        finalEnv[key] = value
      }
    }

    // Add custom args
    let finalArgs = [...args, ...(agentSettings?.customArgs || [])]

    // Add mapped model CLI arg for agents that require startup model selection.
    if (agentSettings?.model) {
      const modelArg = getModelArgForAgent(agentId)
      if (modelArg) {
        finalArgs = [...finalArgs, modelArg, agentSettings.model]
      }
    }

    // Determine spawn parameters (potentially wrapped for WSL)
    let spawnCommand = command
    let spawnArgs = finalArgs
    let spawnCwd = projectPath
    let useWsl = false

    if (process.platform === 'win32' && agentSettings?.runInWsl) {
      useWsl = true
      const wslCwd = toWslPath(projectPath)

      // Use wsl.exe --env flags to pass env vars safely (no shell interpolation)
      const wslArgs: string[] = []
      if (agentSettings.wslDistribution) {
        wslArgs.push('--distribution', agentSettings.wslDistribution)
      }
      for (const [k, v] of Object.entries(finalEnv)) {
        // Validate key is alphanumeric + underscore only
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
          logger.warn(`Skipping invalid environment variable name: ${k}`)
          continue
        }
        wslArgs.push('--env', `${k}=${v}`)
      }
      wslArgs.push('--cd', wslCwd, '--', command, ...finalArgs)

      spawnCommand = 'wsl'
      spawnArgs = wslArgs
      // cwd doesn't matter for wsl.exe, but keep a valid Windows dir
      spawnCwd = projectPath

      logger.info(`WSL spawn: wsl ${spawnArgs.join(' ')}`)
    }

    logger.info(`Launching ${agentId} with command: ${spawnCommand} ${spawnArgs.join(' ')}`)

    // Create ACP client
    const client = new AcpClient(agentId, spawnCommand, spawnArgs, useWsl ? {} : finalEnv, spawnCwd, useWsl)
    if (this.mainWindow) {
      client.setMainWindow(this.mainWindow)
    }

    // Update status
    const emitStatus = (status: AgentStatus, error?: string) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('agent:status-change', {
          connectionId: client.connectionId,
          status,
          error
        })
      }
    }

    try {
      emitStatus('launching')

      // Spawn the process
      await client.start()

      // Initialize ACP
      const initResult = await client.initialize()

      this.connections.set(client.connectionId, client)

      // Auto-authenticate if env_var auth method is available and API key was provided
      await this.autoAuthenticateIfNeeded(client, initResult.authMethods, agentSettings, emitStatus)

      // Always mark as connected — authMethods are informational, not blocking.
      // The agent may still accept sessions/prompts; auth errors surface at prompt time.
      emitStatus('connected')

      return {
        connectionId: client.connectionId,
        agentId,
        agentName: initResult.agentName,
        status: 'connected',
        pid: client.pid,
        startedAt: new Date().toISOString(),
        capabilities: initResult.capabilities,
        authMethods: initResult.authMethods
      }
    } catch (error) {
      client.terminate()
      emitStatus('error', (error as Error).message)
      throw error
    }
  }

  private async autoAuthenticateIfNeeded(
    client: AcpClient,
    authMethods: AuthMethod[],
    agentSettings: ReturnType<typeof settingsService.getAgentSettings>,
    emitStatus: (status: AgentStatus, error?: string) => void
  ): Promise<void> {
    const envVarMethod = authMethods.find((m) => m.type === 'env_var' && m.varName)
    if (!envVarMethod) {
      logger.debug('No env_var auth method available, skipping auto-authenticate')
      return
    }

    const envVarName = envVarMethod.varName!
    const apiKey = this.resolveMappedApiKeyValue(client.agentId, agentSettings, envVarName)
    if (!apiKey) {
      logger.debug(`API key not configured for env_var auth method: ${envVarName}`)
      return
    }

    try {
      logger.info(`Auto-authenticating with env_var method: ${envVarMethod.id}`)
      await client.authenticate(envVarMethod.id, { [envVarName]: apiKey })
    } catch (error) {
      logger.warn(`Auto-authenticate failed for ${envVarMethod.id}:`, error)
      emitStatus('error', `Authentication failed: ${(error as Error).message}`)
    }
  }

  private resolveMappedApiKeyValue(
    agentId: string,
    agentSettings: ReturnType<typeof settingsService.getAgentSettings>,
    envVarName: string
  ): string | undefined {
    const configuredValue = agentSettings?.apiKeys?.[envVarName]
    if (configuredValue) return configuredValue

    // Backward compatibility with legacy single API key setting.
    const legacyApiKey = agentSettings?.apiKey
    if (!legacyApiKey) return undefined

    const mappedEnvVars = getApiKeyEnvVarsForAgent(agentId)
    return mappedEnvVars.includes(envVarName) ? legacyApiKey : undefined
  }

  async authenticate(
    connectionId: string,
    method: string,
    credentials?: Record<string, string>
  ): Promise<void> {
    const client = this.connections.get(connectionId)
    if (!client) throw new Error(`Connection not found: ${connectionId}`)
    await client.authenticate(method, credentials)

    // Emit connected status after successful authentication
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('agent:status-change', {
        connectionId,
        status: 'connected'
      })
    }
  }

  async logout(connectionId: string): Promise<void> {
    const client = this.connections.get(connectionId)
    if (!client) throw new Error(`Connection not found: ${connectionId}`)
    await client.logout()
  }

  terminate(connectionId: string): void {
    const client = this.connections.get(connectionId)
    if (client) {
      client.terminate()
      this.connections.delete(connectionId)
    }
  }

  getClient(connectionId: string): AcpClient | undefined {
    return this.connections.get(connectionId)
  }

  listConnections(): AgentConnection[] {
    return Array.from(this.connections.values()).map((client) => this.toAgentConnection(client))
  }

  async checkAuthentication(agentId: string, projectPath?: string): Promise<AgentAuthCheckResult> {
    const resolvedProjectPath = projectPath || this.resolveOnboardingProjectPath()
    const checkedAt = new Date().toISOString()

    let client = Array.from(this.connections.values()).find(
      (existing) => existing.agentId === agentId && existing.isRunning
    )
    let connection: AgentConnection

    if (!client) {
      connection = await this.launch(agentId, resolvedProjectPath)
      const launchedClient = this.connections.get(connection.connectionId)
      if (!launchedClient) {
        throw new Error(`Connection not found after launching agent: ${agentId}`)
      }
      client = launchedClient
      connection = this.toAgentConnection(client)
    } else {
      connection = this.toAgentConnection(client)
    }

    const authMethods = client.authMethods || []
    if (authMethods.length === 0) {
      return {
        agentId,
        checkedAt,
        projectPath: resolvedProjectPath,
        isAuthenticated: true,
        requiresAuthentication: false,
        authMethods,
        connection
      }
    }

    try {
      await client.newSession(
        resolvedProjectPath,
        [],
        `auth-probe-${uuid().slice(0, 8)}`,
        { suppressInitialUpdates: true }
      )

      return {
        agentId,
        checkedAt,
        projectPath: resolvedProjectPath,
        isAuthenticated: true,
        requiresAuthentication: false,
        authMethods,
        connection
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const requiresAuthentication = this.isAuthenticationError(message)

      return {
        agentId,
        checkedAt,
        projectPath: resolvedProjectPath,
        isAuthenticated: false,
        requiresAuthentication,
        authMethods,
        connection,
        error: message
      }
    }
  }

  async getModels(agentId: string, projectPath: string): Promise<AgentModelCatalog> {
    let connectedClient = Array.from(this.connections.values()).find(
      (client) => client.agentId === agentId && client.isRunning
    )

    if (connectedClient) {
      const cached = connectedClient.getModelCatalog()
      if (cached.availableModels.length > 0) return cached
    }

    let shouldTerminateAfterProbe = false
    if (!connectedClient) {
      await this.launch(agentId, projectPath)
      connectedClient = Array.from(this.connections.values()).find(
        (client) => client.agentId === agentId && client.isRunning
      )
      shouldTerminateAfterProbe = true
    }

    if (!connectedClient) {
      return { availableModels: [] }
    }

    try {
      await connectedClient.newSession(
        projectPath,
        [],
        `model-probe-${uuid().slice(0, 8)}`,
        { suppressInitialUpdates: true }
      )
      return connectedClient.getModelCatalog()
    } catch (error) {
      logger.warn(`Failed to probe models for ${agentId}:`, error)
      throw error
    } finally {
      if (shouldTerminateAfterProbe) {
        this.terminate(connectedClient.connectionId)
      }
    }
  }

  async getModes(agentId: string, projectPath: string): Promise<AgentModeCatalog> {
    let connectedClient = Array.from(this.connections.values()).find(
      (client) => client.agentId === agentId && client.isRunning
    )

    if (connectedClient) {
      const cached = connectedClient.getModeCatalog()
      if (cached.availableModes.length > 0) return cached
    }

    let shouldTerminateAfterProbe = false
    if (!connectedClient) {
      await this.launch(agentId, projectPath)
      connectedClient = Array.from(this.connections.values()).find(
        (client) => client.agentId === agentId && client.isRunning
      )
      shouldTerminateAfterProbe = true
    }

    if (!connectedClient) {
      return { availableModes: [] }
    }

    try {
      await connectedClient.newSession(
        projectPath,
        [],
        `mode-probe-${uuid().slice(0, 8)}`,
        { suppressInitialUpdates: true }
      )
      return connectedClient.getModeCatalog()
    } catch (error) {
      logger.warn(`Failed to probe modes for ${agentId}:`, error)
      throw error
    } finally {
      if (shouldTerminateAfterProbe) {
        this.terminate(connectedClient.connectionId)
      }
    }
  }

  // ============================
  // Helpers
  // ============================

  private resolveSpawnCommand(
    installed: InstalledAgent,
    registryAgent?: AcpRegistryAgent
  ): { command: string; args: string[]; env: Record<string, string> } {
    const dist = registryAgent?.distribution

    if (installed.distributionType === 'npx' && installed.npxPackage) {
      const npxDist = dist?.npx
      const npxArgs = npxDist?.args || []
      const hasYesFlag = npxArgs.includes('-y') || npxArgs.includes('--yes')
      return {
        command: getNpxCommand(),
        args: hasYesFlag
          ? [installed.npxPackage, ...npxArgs]
          : ['-y', installed.npxPackage, ...npxArgs],
        env: npxDist?.env || {}
      }
    }

    if (installed.distributionType === 'uvx' && installed.uvxPackage) {
      const uvxDist = dist?.uvx
      return {
        command: getUvxCommand(),
        args: [installed.uvxPackage, ...(uvxDist?.args || [])],
        env: uvxDist?.env || {}
      }
    }

    if (installed.distributionType === 'binary' && installed.executablePath) {
      const platform = getCurrentPlatformTarget()
      const binaryTarget = platform ? dist?.binary?.[platform] : null
      return {
        command: installed.executablePath,
        args: binaryTarget?.args || [],
        env: {}
      }
    }

    throw new Error(`Cannot resolve spawn command for agent: ${installed.registryId}`)
  }

  private loadInstalled(): void {
    try {
      // Installed agents are stored separately in electron-store
      const store = new (require('electron-store'))({ name: 'installed-agents' })
      const agents = store.get('agents', {}) as Record<string, InstalledAgent>
      for (const [id, agent] of Object.entries(agents)) {
        this.installed.set(id, agent)
      }
    } catch {
      // Fresh install, no agents yet
    }
  }

  private saveInstalled(): void {
    try {
      const store = new (require('electron-store'))({ name: 'installed-agents' })
      store.set('agents', Object.fromEntries(this.installed))
    } catch (err) {
      logger.error('Failed to save installed agents:', err)
    }
  }

  // ============================
  // CLI Detection
  // ============================

  detectCliCommands(commands: string[]): Record<string, boolean> {
    const results: Record<string, boolean> = {}
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'

    for (const cmd of commands) {
      try {
        execSync(`${whichCmd} ${cmd}`, { stdio: 'pipe', timeout: 5000 })
        results[cmd] = true
      } catch {
        results[cmd] = false
      }
    }

    return results
  }

  private toAgentConnection(client: AcpClient): AgentConnection {
    return {
      connectionId: client.connectionId,
      agentId: client.agentId,
      agentName: client.agentName,
      status: client.isRunning ? 'connected' : 'terminated',
      pid: client.pid,
      startedAt: '',
      capabilities: client.capabilities || undefined,
      authMethods: client.authMethods
    }
  }

  private resolveOnboardingProjectPath(): string {
    const configuredDefault = settingsService.get().general.defaultProjectPath
    if (configuredDefault && existsSync(configuredDefault)) {
      return configuredDefault
    }

    const userHome = homedir()
    if (userHome && existsSync(userHome)) {
      return userHome
    }

    return process.cwd()
  }

  private isAuthenticationError(message: string): boolean {
    return /auth|login|unauthorized|credential|api.?key|token|forbidden|401|403/i.test(message)
  }
}

export const agentManager = new AgentManagerService()
