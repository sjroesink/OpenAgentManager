// ============================================================
// Application Settings Types
// ============================================================

export interface AppSettings {
  general: GeneralSettings
  git: GitSettings
  agents: Record<string, AgentSettings>
  mcp: McpSettings
}

export interface GeneralSettings {
  theme: 'light' | 'dark' | 'system'
  defaultProjectPath?: string
  fontSize: number
  showToolCallDetails: boolean
  /** Agent used for auto-generating thread titles from conversation content */
  summarizationAgentId?: string
  /** Model to use for title generation */
  summarizationModel?: string
  /** Terminal shell to use (auto-detected by default based on OS) */
  terminalShell?: string
}

export interface GitSettings {
  enableWorktrees: boolean
  worktreeBaseDir?: string
  autoCommit: boolean
  commitPrefix: string
  cleanupWorktreesOnClose: boolean
}

export interface AgentSettings {
  /**
   * Agent-specific API key values keyed by environment variable name.
   * Example: { GH_COPILOT_TOKEN: "..." }
   */
  apiKeys?: Record<string, string>
  /** @deprecated Use apiKeys instead. */
  apiKey?: string
  model?: string
  customArgs?: string[]
  customEnv?: Record<string, string>
  autoApproveRead?: boolean
  runInWsl?: boolean
  wslDistribution?: string
}

export interface McpSettings {
  servers: McpServerConfig[]
}

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  enabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    theme: 'system',
    fontSize: 14,
    showToolCallDetails: true
  },
  git: {
    enableWorktrees: true,
    autoCommit: false,
    commitPrefix: 'agent: ',
    cleanupWorktreesOnClose: false
  },
  agents: {},
  mcp: {
    servers: []
  }
}
