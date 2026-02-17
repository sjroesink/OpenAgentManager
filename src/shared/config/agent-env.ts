export interface AgentEnvConfig {
  apiKeyEnvVars: string[]
  modelEnvVars?: string[]
  modelArg?: string
}

/**
 * Static agent -> accepted API key env variables mapping.
 * Extend this map when adding support for additional agents.
 */
export const AGENT_ENV_CONFIG: Record<string, AgentEnvConfig> = {
  'github-copilot': {
    apiKeyEnvVars: ['GH_COPILOT_TOKEN', 'GITHUB_COPILOT_TOKEN']
  },
  'claude-code': {
    apiKeyEnvVars: ['ANTHROPIC_API_KEY'],
    modelEnvVars: ['ANTHROPIC_MODEL'],
    modelArg: '--model'
  },
  codex: {
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    modelArg: '--model'
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
