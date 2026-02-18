export interface ApiKeyInfo {
  envVar: string
  /** Human-readable description shown in the onboarding wizard */
  description: string
  /** URL where users can create/manage this key */
  providerUrl: string
  /** Short label for the provider (e.g., "Anthropic Console") */
  providerLabel: string
}

export interface AgentEnvConfig {
  apiKeyEnvVars: string[]
  modelEnvVars?: string[]
  modelArg?: string
  /** Rich metadata for each API key env var, used in onboarding wizard */
  apiKeyInfo?: Record<string, ApiKeyInfo>
  /** CLI command name(s) to check on system PATH for pre-installed detection */
  cliCommands?: string[]
}

/**
 * Static agent -> accepted API key env variables mapping.
 * Extend this map when adding support for additional agents.
 */
export const AGENT_ENV_CONFIG: Record<string, AgentEnvConfig> = {
  'github-copilot': {
    apiKeyEnvVars: ['GH_COPILOT_TOKEN', 'GITHUB_COPILOT_TOKEN'],
    cliCommands: ['github-copilot'],
    apiKeyInfo: {
      GH_COPILOT_TOKEN: {
        envVar: 'GH_COPILOT_TOKEN',
        description:
          'GitHub Copilot authentication token. Usually obtained through GitHub CLI login.',
        providerUrl: 'https://github.com/settings/copilot',
        providerLabel: 'GitHub Copilot Settings'
      },
      GITHUB_COPILOT_TOKEN: {
        envVar: 'GITHUB_COPILOT_TOKEN',
        description: 'Alternative GitHub Copilot token variable name.',
        providerUrl: 'https://github.com/settings/copilot',
        providerLabel: 'GitHub Copilot Settings'
      }
    }
  },
  'claude-code': {
    apiKeyEnvVars: ['ANTHROPIC_API_KEY'],
    modelEnvVars: ['ANTHROPIC_MODEL'],
    modelArg: '--model',
    cliCommands: ['claude'],
    apiKeyInfo: {
      ANTHROPIC_API_KEY: {
        envVar: 'ANTHROPIC_API_KEY',
        description:
          "API key for Anthropic's Claude models. Required to use the Claude Code agent.",
        providerUrl: 'https://console.anthropic.com/settings/keys',
        providerLabel: 'Anthropic Console'
      }
    }
  },
  codex: {
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    modelArg: '--model',
    cliCommands: ['codex'],
    apiKeyInfo: {
      OPENAI_API_KEY: {
        envVar: 'OPENAI_API_KEY',
        description: 'API key for OpenAI models. Required to use the Codex agent.',
        providerUrl: 'https://platform.openai.com/api-keys',
        providerLabel: 'OpenAI Platform'
      }
    }
  }
}

export function getApiKeyEnvVarsForAgent(agentId: string): string[] {
  return AGENT_ENV_CONFIG[agentId]?.apiKeyEnvVars ?? []
}

export function getModelEnvVarsForAgent(agentId: string): string[] {
  return AGENT_ENV_CONFIG[agentId]?.modelEnvVars ?? []
}

export function getModelArgForAgent(agentId: string): string | undefined {
  return AGENT_ENV_CONFIG[agentId]?.modelArg
}

export function getApiKeyInfoForAgent(agentId: string): ApiKeyInfo[] {
  const config = AGENT_ENV_CONFIG[agentId]
  if (!config?.apiKeyInfo) return []
  return Object.values(config.apiKeyInfo)
}

export function getCliCommandsForAgent(agentId: string): string[] {
  return AGENT_ENV_CONFIG[agentId]?.cliCommands ?? []
}
