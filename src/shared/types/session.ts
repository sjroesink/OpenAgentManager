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
  interactionMode?: InteractionMode
  useWorktree: boolean
  workspaceId: string
  /** ID of the parent session this was forked from. Undefined for root sessions. */
  parentSessionId?: string
  /** The first prompt to be sent once session creation completes. UI-only field. */
  pendingPrompt?: string
  /** Tracks agent initialization progress (launching, connecting, creating session). UI-only field. */
  initProgress?: HookStep[]
  /** Error message from failed initialization. UI-only field. */
  initError?: string
  /** Error message from the most recent prompt failure. UI-only field. */
  lastError?: string
}

export type SessionStatus = 'initializing' | 'creating' | 'active' | 'prompting' | 'idle' | 'cancelled' | 'error'

export type InteractionMode = 'ask' | 'code' | 'plan' | 'act' | string

export interface Message {
  id: string
  role: 'user' | 'agent'
  content: ContentBlock[]
  timestamp: string
  toolCalls?: ToolCallInfo[]
  isStreaming?: boolean
}

// ACP Content Block types (spec-aligned)
// See: https://agentclientprotocol.com/protocol/content

export interface ContentAnnotations {
  /** Describes intended audience: 'user' | 'assistant' | 'internal' */
  audience?: string[]
  /** Priority hint for display ordering */
  priority?: number
  /** Custom metadata */
  _meta?: Record<string, unknown>
}

export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceContent
  | ResourceLinkContent
  | ThinkingContent
  | ToolCallRefContent

export interface TextContent {
  type: 'text'
  text: string
  annotations?: ContentAnnotations
}

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
  uri?: string
  annotations?: ContentAnnotations
}

export interface AudioContent {
  type: 'audio'
  data: string
  mimeType: string
  annotations?: ContentAnnotations
}

/** Embedded resource (text or blob) */
export interface ResourceContent {
  type: 'resource'
  resource: EmbeddedResourceData
  annotations?: ContentAnnotations
}

export interface EmbeddedResourceData {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

/** Link to a resource without inline content */
export interface ResourceLinkContent {
  type: 'resource_link'
  uri: string
  name: string
  mimeType?: string
  title?: string
  description?: string
  size?: number
  annotations?: ContentAnnotations
}

export interface ThinkingContent {
  type: 'thinking'
  text: string
}

export interface ToolCallRefContent {
  type: 'tool_call_ref'
  toolCallId: string
}

// ACP tool call kind categories
export type ToolCallKind =
  | 'read' | 'edit' | 'delete' | 'move'
  | 'search' | 'execute' | 'think' | 'fetch'
  | 'other'

export type ToolCallStatus = 'pending' | 'in_progress' | 'running' | 'completed' | 'failed'

/** Location affected by a tool call (for file-following) */
export interface ToolCallLocation {
  path: string
  line?: number
}

export interface ToolCallInfo {
  toolCallId: string
  title: string
  name: string
  kind?: ToolCallKind
  status: ToolCallStatus
  input?: string
  output?: string
  rawInput?: unknown
  rawOutput?: unknown
  diff?: DiffContent
  locations?: ToolCallLocation[]
}

export interface DiffContent {
  path: string
  oldText: string
  newText: string
}

// ACP stop reasons (spec-aligned)
export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | 'error'

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
  | { type: 'tool_call_update'; toolCallId: string; status: ToolCallStatus; output?: string; locations?: ToolCallLocation[] }
  | { type: 'message_complete'; messageId: string; stopReason: StopReason }
  | { type: 'status_change'; status: SessionStatus }
  | { type: 'error'; error: string }
  // ACP spec: session mode/config updates
  | { type: 'current_mode_update'; modeId: string }
  | { type: 'config_options_update'; options: ConfigOption[] }
  | { type: 'available_commands_update'; commands: SlashCommand[] }
  | { type: 'plan_update'; entries: PlanEntry[] }
  // RFD: session info + usage updates
  | { type: 'session_info_update'; title?: string | null; updatedAt?: string | null; _meta?: Record<string, unknown> | null }
  | { type: 'usage_update'; usage: UsageUpdate }

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
  interactionMode?: InteractionMode
  modelId?: string
  title?: string
  branchName?: string
}

export interface HookStep {
  label: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  detail?: string
}

export interface WorktreeHookProgressEvent {
  sessionId: string
  steps: HookStep[]
}

// ============================================================
// ACP Session Modes & Config Options (spec-aligned)
// See: https://agentclientprotocol.com/protocol/session-modes
// See: https://agentclientprotocol.com/protocol/session-config-options
// ============================================================

export interface SessionMode {
  id: string
  name: string
  description?: string
}

export interface SessionModeState {
  currentModeId: string
  availableModes: SessionMode[]
}

/** Config option categories (spec reserved + custom _-prefixed) */
export type ConfigOptionCategory = 'mode' | 'model' | 'thought_level' | string

export interface ConfigOptionValue {
  value: string
  name: string
  description?: string
}

export interface ConfigOption {
  id: string
  name: string
  description?: string
  category?: ConfigOptionCategory
  type: 'select'
  currentValue: string
  options: ConfigOptionValue[]
}

// ============================================================
// ACP Slash Commands (spec-aligned)
// See: https://agentclientprotocol.com/protocol/slash-commands
// ============================================================

export interface SlashCommand {
  name: string
  description: string
  input?: {
    hint: string
  }
}

// ============================================================
// ACP Agent Plan (spec-aligned)
// See: https://agentclientprotocol.com/protocol/agent-plan
// ============================================================

export interface PlanEntry {
  content: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
}

// ============================================================
// ACP Usage & Context (RFD - draft)
// See: https://agentclientprotocol.com/rfds/session-usage
// ============================================================

export interface TokenUsage {
  total_tokens: number
  input_tokens: number
  output_tokens: number
  thought_tokens?: number
  cached_read_tokens?: number
  cached_write_tokens?: number
}

export interface UsageUpdate {
  used: number
  size: number
  cost?: {
    amount: number
    currency: string
  }
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
  interactionMode?: InteractionMode
  useWorktree: boolean
  workspaceId: string
  /** ID of the parent session this was forked from. */
  parentSessionId?: string
}
