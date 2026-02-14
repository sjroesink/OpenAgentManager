// ============================================================
// Agent Thread Storage Format (ATSF) v1.1 Types
// ============================================================

export const ATSF_SPEC_VERSION = '1.1'
export const AGENT_DIR_NAME = '.agent'
export const THREADS_DIR_NAME = 'threads'
export const THREAD_MANIFEST_FILE = 'thread.json'
export const MESSAGES_FILE = 'messages.jsonl'
export const ASSETS_DIR_NAME = 'assets'

// ---- Project-level config ----

export interface AgentProjectConfig {
  specVersion: string
  createdBy?: {
    name: string
    version: string
  }
  defaults?: {
    agentId?: string
    interactionMode?: string
    useWorktree?: boolean
  }
  agentSettings?: Record<string, Record<string, unknown>>
  worktreeHooks?: WorktreeHooksConfig
}

// ---- Worktree hooks (v1.1+) ----

export interface WorktreeHooksConfig {
  /** Shell commands to run in the worktree directory after creation. */
  postSetupCommands?: PostSetupCommand[]
  /** Symlinks to create from worktree pointing to original repo paths. */
  symlinks?: SymlinkEntry[]
  /** Prompt auto-sent to the agent after session creation. */
  initialPrompt?: string
}

export interface PostSetupCommand {
  /** Shell command to execute (e.g., "npm install"). */
  command: string
  /** Human-readable label shown during execution. */
  label?: string
  /** Timeout in milliseconds. Defaults to 120000 (2 min). 0 = no timeout. */
  timeout?: number
  /** If true, continue with remaining commands on failure. Defaults to false. */
  continueOnError?: boolean
  /** Only run on specific platforms. If omitted, runs on all. */
  platforms?: Array<'win32' | 'darwin' | 'linux'>
}

export interface SymlinkEntry {
  /** Path relative to the original repo root (link target). */
  source: string
  /** Path relative to the worktree root where the link is created. Defaults to source. */
  target?: string
}

// ---- Thread manifest ----

export interface ThreadManifest {
  specVersion: string
  threadId: string
  title: string
  createdAt: string
  updatedAt: string
  agent: {
    id: string
    name: string
    version?: string
    protocol?: string
    protocolVersion?: number
  }
  context: {
    workingDir: string
    relativeDir?: string
    gitBranch?: string
    gitCommit?: string
    worktree?: {
      path: string
      branch: string
    }
  }
  stats: {
    messageCount: number
    userMessageCount: number
    agentMessageCount: number
    toolCallCount: number
  }
  metadata?: Record<string, unknown>
}

// ---- Stored message (one line in messages.jsonl) ----

export interface StoredMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  timestamp: string
  content: StoredContentBlock[]
  toolCalls?: StoredToolCall[]
  stopReason?: string
  model?: string
  tokens?: {
    input?: number
    output?: number
  }
}

export type StoredContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'image'; assetRef: string; mimeType: string }
  | { type: 'tool_call_ref'; toolCallId: string }

export interface StoredToolCall {
  toolCallId: string
  name: string
  title?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: string
  output?: string
  duration?: number
  diff?: {
    path: string
    oldText: string
    newText: string
  }
}
