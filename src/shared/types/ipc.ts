// ============================================================
// IPC Channel Definitions & Payloads
// Typed contract between main and renderer processes
// ============================================================

import type {
  AcpRegistry,
  InstalledAgent,
  AgentConnection,
  AgentAuthCheckResult,
  AgentModelCatalog,
  AgentModeCatalog
} from './agent'
import type {
  SessionInfo,
  PersistedThread,
  CreateSessionRequest,
  PromptResult,
  SessionUpdateEvent,
  PermissionRequestEvent,
  PermissionResponse,
  PermissionRule,
  PermissionResolvedEvent,
  InteractionMode,
  WorktreeHookProgressEvent,
  ConfigOption,
  ContentBlock
} from './session'
import type { AgentProjectConfig } from './thread-format'
import type { ProjectInfo, FileTreeNode, FileChange, DiffResult } from './project'
import type { GitStatus, WorktreeInfo, CommitResult } from './git'
import type { AppSettings } from './settings'
import type { WorkspaceInfo } from './workspace'

// ============================================================
// Request/Response channels (ipcMain.handle / ipcRenderer.invoke)
// ============================================================
export interface IpcChannels {
  // --- Registry ---
  'registry:fetch': { request: void; response: AcpRegistry }
  'registry:get-cached': { request: void; response: AcpRegistry | null }
  'registry:get-icon-svg': { request: { agentId: string; icon?: string }; response: string | null }

  // --- Agent Management ---
  'agent:install': { request: { agentId: string }; response: InstalledAgent }
  'agent:uninstall': { request: { agentId: string }; response: void }
  'agent:list-installed': { request: void; response: InstalledAgent[] }
  'agent:launch': { request: { agentId: string; projectPath: string; extraEnv?: Record<string, string> }; response: AgentConnection }
  'agent:check-auth': { request: { agentId: string; projectPath?: string }; response: AgentAuthCheckResult }
  'agent:terminate': { request: { connectionId: string }; response: void }
  'agent:authenticate': {
    request: { connectionId: string; method: string; credentials?: Record<string, string> }
    response: void
  }
  'agent:logout': { request: { connectionId: string }; response: void }
  'agent:list-connections': { request: void; response: AgentConnection[] }
  'agent:get-models': { request: { agentId: string; projectPath: string }; response: AgentModelCatalog }
  'agent:get-modes': { request: { agentId: string; projectPath: string }; response: AgentModeCatalog }

  // --- Sessions ---
  'session:create': { request: CreateSessionRequest; response: SessionInfo }
  'session:prompt': { request: { sessionId: string; content: ContentBlock[]; mode?: InteractionMode }; response: PromptResult }
  'session:cancel': { request: { sessionId: string }; response: void }
  'session:list': { request: void; response: SessionInfo[] }
  'session:list-persisted': { request: void; response: PersistedThread[] }
  'session:remove': { request: { sessionId: string; cleanupWorktree: boolean }; response: void }
  'session:permission-response': { request: PermissionResponse; response: void }
  'session:rebuild-cache': { request: void; response: { threadCount: number } }
  'session:set-mode': { request: { sessionId: string; modeId: string }; response: void }
  'session:set-interaction-mode': { request: { sessionId: string; mode: InteractionMode }; response: void }
  'session:rename': { request: { sessionId: string; title: string }; response: void }
  'session:set-model': { request: { sessionId: string; modelId: string }; response: void }
  'session:set-config-option': { request: { sessionId: string; configId: string; value: string }; response: ConfigOption[] }
  'session:generate-title': { request: { sessionId: string }; response: string | null }
  'session:fork': { request: { sessionId: string; title?: string }; response: SessionInfo }
  'session:ensure-connected': { request: { sessionId: string }; response: { connectionId: string } }

  // --- Files ---
  'file:read-tree': { request: { dirPath: string; depth?: number }; response: FileTreeNode[] }
  'file:read': { request: { filePath: string }; response: string }
  'file:get-changes': { request: { workingDir: string }; response: FileChange[] }

  // --- Project ---
  'project:open': { request: { path: string }; response: ProjectInfo }
  'project:select-directory': { request: void; response: string | null }

  // --- Git ---
  'git:status': { request: { projectPath: string }; response: GitStatus }
  'git:create-worktree': {
    request: { basePath: string; sessionId: string; baseBranch?: string }
    response: WorktreeInfo
  }
  'git:remove-worktree': { request: { projectPath: string; worktreePath: string }; response: void }
  'git:list-worktrees': { request: { projectPath: string }; response: WorktreeInfo[] }
  'git:commit': {
    request: { worktreePath: string; message: string; files: string[] }
    response: CommitResult
  }
  'git:diff': { request: { worktreePath: string; filePath?: string }; response: DiffResult }
  'git:rename-branch': {
    request: { worktreePath: string; newBranch: string }
    response: string
  }

  // --- Sessions (branch rename) ---
  'session:rename-branch': {
    request: { sessionId: string; newBranch: string }
    response: string
  }

  // --- Terminal ---
  'terminal:create': { request: { cwd: string; sessionId: string }; response: string }
  'terminal:write': { request: { terminalId: string; data: string }; response: void }
  'terminal:resize': { request: { terminalId: string; cols: number; rows: number }; response: void }
  'terminal:kill': { request: { terminalId: string }; response: void }

  // --- Workspaces ---
  'workspace:list': { request: void; response: WorkspaceInfo[] }
  'workspace:create': { request: { path: string; name?: string }; response: WorkspaceInfo }
  'workspace:remove': { request: { id: string; cleanupWorktrees?: boolean }; response: void }
  'workspace:update': {
    request: {
        id: string
        updates: Partial<Pick<WorkspaceInfo, 'name' | 'lastAccessedAt' | 'defaultAgentId' | 'defaultModelId' | 'defaultInteractionMode' | 'defaultUseWorktree'>>
      }
    response: WorkspaceInfo
  }
  'workspace:select-directory': { request: void; response: string | null }
  'workspace:open-in-vscode': { request: { path: string }; response: void }
  'workspace:open-directory': { request: { path: string }; response: void }
  'workspace:get-config': { request: { workspacePath: string }; response: AgentProjectConfig | null }
  'workspace:set-config': {
    request: { workspacePath: string; config: AgentProjectConfig }
    response: void
  }

  // --- Settings ---
  'settings:get': { request: void; response: AppSettings }
  'settings:set': { request: Partial<AppSettings>; response: void }
  'settings:set-agent': { request: { agentId: string; settings: Record<string, unknown> }; response: void }

  // --- Permission Rules ---
  'permission:save-rule': {
    request: Omit<PermissionRule, 'id' | 'createdAt'>
    response: PermissionRule
  }
  'permission:list-rules': {
    request: { workspaceId?: string }
    response: PermissionRule[]
  }
  'permission:remove-rule': {
    request: { ruleId: string }
    response: void
  }

  // --- Agent CLI Detection ---
  'agent:detect-cli': {
    request: { commands: string[] }
    response: Record<string, boolean>
  }

  // --- System ---
  'system:wsl-info': {
    request: void
    response: { available: boolean; distributions: string[] }
  }

  // --- Window ---
  'window:reload': { request: void; response: void }
  'window:toggle-devtools': { request: void; response: void }
  'window:reset-zoom': { request: void; response: void }
  'window:zoom-in': { request: void; response: void }
  'window:zoom-out': { request: void; response: void }
  'window:toggle-fullscreen': { request: void; response: void }
  'window:minimize': { request: void; response: void }
  'window:close': { request: void; response: void }
  'window:quit': { request: void; response: void }
}

// ============================================================
// Event channels (main -> renderer, streaming)
// ============================================================
export interface IpcEvents {
  'session:update': SessionUpdateEvent
  'session:permission-request': PermissionRequestEvent
  'session:permission-resolved': PermissionResolvedEvent
  'session:hook-progress': WorktreeHookProgressEvent
  'terminal:data': { terminalId: string; data: string }
  'agent:status-change': { connectionId: string; status: AgentConnection['status']; error?: string }
}

// ============================================================
// Type helper for the preload API
// ============================================================
export interface ElectronAPI {
  invoke<T extends keyof IpcChannels>(
    channel: T,
    data: IpcChannels[T]['request']
  ): Promise<IpcChannels[T]['response']>

  on<T extends keyof IpcEvents>(
    channel: T,
    callback: (data: IpcEvents[T]) => void
  ): () => void

  off<T extends keyof IpcEvents>(
    channel: T,
    callback: (data: IpcEvents[T]) => void
  ): void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
