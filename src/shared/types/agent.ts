// ============================================================
// ACP Registry & Agent Types
// ============================================================

/** Raw registry format from CDN */
export interface AcpRegistry {
  version: string
  agents: AcpRegistryAgent[]
  extensions: unknown[]
}

export interface AcpRegistryAgent {
  id: string
  name: string
  version: string
  description: string
  repository?: string
  authors: string[]
  license: string
  icon: string
  distribution: AgentDistribution
}

export interface AgentDistribution {
  npx?: NpxDistribution
  uvx?: UvxDistribution
  binary?: BinaryDistribution
}

export interface NpxDistribution {
  package: string
  args?: string[]
  env?: Record<string, string>
}

export interface UvxDistribution {
  package: string
  args?: string[]
  env?: Record<string, string>
}

export interface BinaryDistribution {
  'darwin-aarch64'?: BinaryTarget
  'darwin-x86_64'?: BinaryTarget
  'linux-aarch64'?: BinaryTarget
  'linux-x86_64'?: BinaryTarget
  'windows-aarch64'?: BinaryTarget
  'windows-x86_64'?: BinaryTarget
}

export interface BinaryTarget {
  archive: string
  cmd: string
  args?: string[]
}

/** Tracked installed agent */
export interface InstalledAgent {
  registryId: string
  name: string
  version: string
  description: string
  installedAt: string
  distributionType: 'npx' | 'uvx' | 'binary'
  executablePath?: string
  npxPackage?: string
  uvxPackage?: string
  icon: string
  authors: string[]
  license: string
}

export type AgentStatus = 'idle' | 'launching' | 'connected' | 'authenticating' | 'error' | 'terminated'

export interface AgentConnection {
  connectionId: string
  agentId: string
  agentName: string
  status: AgentStatus
  pid?: number
  startedAt: string
  capabilities?: AgentCapabilities
  authMethods?: AuthMethod[]
  error?: string
}

/** ACP agent capabilities (spec-aligned naming) */
export interface AgentCapabilities {
  // Spec: top-level boolean for session loading
  loadSession?: boolean

  // Spec: promptCapabilities
  promptCapabilities?: {
    image?: boolean
    audio?: boolean
    embeddedContext?: boolean
  }

  // Spec: mcp
  mcp?: {
    http?: boolean
    sse?: boolean
  }

  // Session management capabilities (from RFDs)
  sessionCapabilities?: {
    list?: Record<string, unknown>
    delete?: Record<string, unknown>
    fork?: Record<string, unknown>
    resume?: Record<string, unknown>
  }

  // Extensibility
  _meta?: Record<string, unknown>
}

export interface AuthMethod {
  id: string
  name: string
  description?: string
}

export type PlatformTarget =
  | 'darwin-aarch64'
  | 'darwin-x86_64'
  | 'linux-aarch64'
  | 'linux-x86_64'
  | 'windows-aarch64'
  | 'windows-x86_64'
