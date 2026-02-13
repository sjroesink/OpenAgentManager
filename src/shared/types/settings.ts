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
}

export interface GitSettings {
  enableWorktrees: boolean
  worktreeBaseDir?: string
  autoCommit: boolean
  commitPrefix: string
  cleanupWorktreesOnClose: boolean
}

export interface AgentSettings {
  apiKey?: string
  customArgs?: string[]
  customEnv?: Record<string, string>
  autoApproveRead?: boolean
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
    theme: 'dark',
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
