#!/usr/bin/env node

/**
 * MCP Bridge for AgentManager
 *
 * Standalone Node.js script that implements the MCP protocol over stdio
 * and proxies tool calls to the AgentManager Electron app's internal HTTP API.
 *
 * Claude Code spawns this script and communicates with it over stdio.
 * This script discovers the running Electron app's port and auth token
 * from files in the app's userData directory.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ============================================================
// Discovery: find the running Electron app
// ============================================================

function getAppDataDir(): string {
  const platform = process.platform
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'agent-manager')
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'agent-manager')
  } else {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'agent-manager')
  }
}

function discover(): { port: number; token: string } {
  const dataDir = getAppDataDir()
  const portFile = path.join(dataDir, 'mcp-port')
  const tokenFile = path.join(dataDir, 'mcp-token')

  if (!fs.existsSync(portFile) || !fs.existsSync(tokenFile)) {
    throw new Error(
      `AgentManager is not running or MCP API is not available.\n` +
      `Expected files at: ${portFile} and ${tokenFile}\n` +
      `Start AgentManager first, then retry.`
    )
  }

  const port = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10)
  const token = fs.readFileSync(tokenFile, 'utf-8').trim()

  if (isNaN(port) || !token) {
    throw new Error('Invalid MCP discovery files. Restart AgentManager.')
  }

  return { port, token }
}

// ============================================================
// HTTP client for the internal API
// ============================================================

async function callApi(
  port: number,
  token: string,
  endpoint: string,
  body: Record<string, unknown> = {},
  timeoutMs = 30_000
): Promise<unknown> {
  const url = `http://127.0.0.1:${port}${endpoint}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${response.status}`)
    }

    return data
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================
// MCP Server setup
// ============================================================

const server = new McpServer({
  name: 'agent-manager',
  version: '1.0.0'
})

let apiPort: number
let apiToken: string

// Helper to make API calls with discovered credentials
function api(endpoint: string, body: Record<string, unknown> = {}, timeoutMs?: number) {
  return callApi(apiPort, apiToken, endpoint, body, timeoutMs)
}

// ============================================================
// Tool registration
// ============================================================

server.tool(
  'app_health',
  'Check if AgentManager is running and get a summary of its state',
  async () => {
    const result = await api('/api/health')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'workspace_list',
  'List all workspaces in AgentManager',
  async () => {
    const result = await api('/api/workspace/list')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'workspace_create',
  'Create a new workspace from a directory path',
  { path: z.string().describe('Directory path for the workspace'), name: z.optional(z.string()).describe('Display name (defaults to directory name)') },
  async ({ path, name }) => {
    const result = await api('/api/workspace/create', { path, name })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'agent_list_installed',
  'List all installed AI coding agents',
  async () => {
    const result = await api('/api/agent/list-installed')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'agent_list_connections',
  'List all active agent connections',
  async () => {
    const result = await api('/api/agent/list-connections')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'agent_launch',
  'Launch an installed agent for a project directory',
  {
    agentId: z.string().describe('ID of the installed agent'),
    projectPath: z.string().describe('Path to the project directory')
  },
  async ({ agentId, projectPath }) => {
    const result = await api('/api/agent/launch', { agentId, projectPath }, 60_000)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'agent_terminate',
  'Terminate an active agent connection',
  { connectionId: z.string().describe('Connection ID to terminate') },
  async ({ connectionId }) => {
    const result = await api('/api/agent/terminate', { connectionId })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'session_create',
  'Create a new coding session with an agent',
  {
    connectionId: z.string().describe('Agent connection ID'),
    workingDir: z.string().describe('Working directory for the session'),
    workspaceId: z.string().describe('Workspace ID this session belongs to'),
    useWorktree: z.optional(z.boolean()).describe('Create a git worktree for isolation'),
    title: z.optional(z.string()).describe('Session title')
  },
  async ({ connectionId, workingDir, workspaceId, useWorktree, title }) => {
    const result = await api('/api/session/create', {
      connectionId, workingDir, workspaceId,
      useWorktree: useWorktree || false,
      title
    }, 60_000)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'session_list',
  'List all active sessions (metadata only, no messages)',
  async () => {
    const result = await api('/api/session/list')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'session_list_persisted',
  'List all persisted threads/sessions (metadata only)',
  async () => {
    const result = await api('/api/session/list-persisted')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'session_get',
  'Get full session details including all messages',
  { sessionId: z.string().describe('Session ID') },
  async ({ sessionId }) => {
    const result = await api('/api/session/get', { sessionId })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'session_prompt',
  'Send a prompt to a session. Blocks until the agent responds (may take minutes).',
  {
    sessionId: z.string().describe('Session ID'),
    text: z.string().describe('Prompt text to send'),
    mode: z.optional(z.enum(['ask', 'code', 'plan', 'act'])).describe('Interaction mode')
  },
  async ({ sessionId, text, mode }) => {
    const result = await api('/api/session/prompt', { sessionId, text, mode }, 10 * 60 * 1000)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'session_cancel',
  'Cancel a running prompt in a session',
  { sessionId: z.string().describe('Session ID') },
  async ({ sessionId }) => {
    const result = await api('/api/session/cancel', { sessionId })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'session_fork',
  'Fork an existing session, creating a new session with the same conversation context',
  {
    sessionId: z.string().describe('Session ID to fork'),
    title: z.optional(z.string()).describe('Title for the forked session')
  },
  async ({ sessionId, title }) => {
    const result = await api('/api/session/fork', { sessionId, title }, 60_000)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'session_remove',
  'Remove a session and optionally clean up its worktree',
  {
    sessionId: z.string().describe('Session ID'),
    cleanupWorktree: z.optional(z.boolean()).describe('Also remove the git worktree')
  },
  async ({ sessionId, cleanupWorktree }) => {
    const result = await api('/api/session/remove', { sessionId, cleanupWorktree: cleanupWorktree || false })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'permission_list_pending',
  'List all pending permission requests across all sessions',
  async () => {
    const result = await api('/api/session/pending-permissions')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'permission_respond',
  'Respond to a pending permission request',
  {
    requestId: z.string().describe('Permission request ID'),
    optionId: z.string().describe('Selected option ID (e.g. "allow", "deny")')
  },
  async ({ requestId, optionId }) => {
    const result = await api('/api/session/permission-response', { requestId, optionId })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'git_status',
  'Get git status for a project directory',
  { projectPath: z.string().describe('Path to the git repository') },
  async ({ projectPath }) => {
    const result = await api('/api/git/status', { projectPath })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'git_diff',
  'Get diffs for a working directory',
  {
    workingDir: z.string().describe('Working directory path'),
    filePath: z.optional(z.string()).describe('Specific file to diff (optional)')
  },
  async ({ workingDir, filePath }) => {
    const result = await api('/api/git/diff', { workingDir, filePath })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'file_read_tree',
  'Read directory tree structure',
  {
    dirPath: z.string().describe('Directory path'),
    depth: z.optional(z.number()).describe('Maximum depth (default 3)')
  },
  async ({ dirPath, depth }) => {
    const result = await api('/api/file/read-tree', { dirPath, depth })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'file_read',
  'Read contents of a file',
  { filePath: z.string().describe('Path to the file') },
  async ({ filePath }) => {
    const result = await api('/api/file/read', { filePath })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'settings_get',
  'Get current AgentManager app settings',
  async () => {
    const result = await api('/api/settings/get')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

// ============================================================
// Main
// ============================================================

async function main() {
  // Discover the running Electron app
  try {
    const { port, token } = discover()
    apiPort = port
    apiToken = token
  } catch (err) {
    // Write error to stderr (won't interfere with stdio MCP transport)
    process.stderr.write(`[agent-manager-mcp] ${(err as Error).message}\n`)
    // Still start the server - tools will fail with descriptive errors
    apiPort = 0
    apiToken = ''
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)

  process.stderr.write(`[agent-manager-mcp] MCP server started, connected to AgentManager on port ${apiPort}\n`)
}

main().catch((err) => {
  process.stderr.write(`[agent-manager-mcp] Fatal error: ${(err as Error).message}\n`)
  process.exit(1)
})
