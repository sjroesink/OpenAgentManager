// ============================================================
// Shared Constants
// ============================================================

export const ACP_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

export const ACP_CDN_URL = 'https://cdn.agentclientprotocol.com'

export const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export function getAgentIconUrl(agentId: string, icon?: string): string | undefined {
  if (!icon) return undefined
  if (icon.startsWith('http')) return icon
  return `${ACP_CDN_URL}/registry/v1/latest/dist/${agentId}.svg`
}

export const APP_NAME = 'AgentManager'

export const DEFAULT_WORKTREE_PREFIX = 'am-'

export const ACP_PROTOCOL_VERSION = 1

export const CLIENT_INFO = {
  name: APP_NAME,
  title: 'Open Agent Manager',
  version: '1.0.0'
} as const
