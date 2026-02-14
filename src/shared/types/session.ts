// ============================================================
// Session, Thread & Message Types
// ============================================================

export interface SessionInfo {
  sessionId: string
  connectionId: string
  agentId: string
  agentName: string
  title: string
  createdAt: string
  worktreePath?: string
  worktreeBranch?: string
  workingDir: string
  status: SessionStatus
  messages: Message[]
  useWorktree: boolean
  workspaceId: string
}

export type SessionStatus = 'creating' | 'active' | 'prompting' | 'idle' | 'cancelled' | 'error'

export type InteractionMode = 'ask' | 'code' | 'plan' | 'act'

export interface Message {
  id: string
  role: 'user' | 'agent'
  content: ContentBlock[]
  timestamp: string
  toolCalls?: ToolCallInfo[]
  isStreaming?: boolean
}

export type ContentBlock =
  | TextContent
  | ImageContent
  | ThinkingContent

export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export interface ThinkingContent {
  type: 'thinking'
  text: string
}

export interface ToolCallInfo {
  toolCallId: string
  title: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: string
  output?: string
  diff?: DiffContent
}

export interface DiffContent {
  path: string
  oldText: string
  newText: string
}

export type StopReason = 'end_turn' | 'max_tokens' | 'cancelled' | 'error'

export interface PromptResult {
  stopReason: StopReason
}

// Session update events streamed from main to renderer
export interface SessionUpdateEvent {
  sessionId: string
  update: SessionUpdate
}

export type SessionUpdate =
  | { type: 'message_start'; messageId: string }
  | { type: 'text_chunk'; messageId: string; text: string }
  | { type: 'thinking_chunk'; messageId: string; text: string }
  | { type: 'tool_call_start'; messageId: string; toolCall: ToolCallInfo }
  | { type: 'tool_call_update'; toolCallId: string; status: ToolCallInfo['status']; output?: string }
  | { type: 'message_complete'; messageId: string; stopReason: StopReason }
  | { type: 'status_change'; status: SessionStatus }
  | { type: 'error'; error: string }

export interface PermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface PermissionToolCall {
  toolCallId: string
  title?: string
  kind?: string
  rawInput?: unknown
}

export interface PermissionRequestEvent {
  sessionId: string
  requestId: string
  toolCall: PermissionToolCall
  options: PermissionOption[]
}

export interface PermissionResponse {
  requestId: string
  optionId: string
}

export interface CreateSessionRequest {
  connectionId: string
  workingDir: string
  useWorktree: boolean
  workspaceId: string
  title?: string
}

/**
 * Subset of SessionInfo that gets persisted to disk.
 * Excludes volatile runtime state (connectionId, isStreaming).
 */
export interface PersistedThread {
  sessionId: string
  agentId: string
  agentName: string
  title: string
  createdAt: string
  worktreePath?: string
  worktreeBranch?: string
  workingDir: string
  messages: Message[]
  useWorktree: boolean
  workspaceId: string
}
