# Architecture Improvements - OpenAgentManager

> Comprehensive code review and architectural analysis
> Date: 2026-02-16 | Reviewer: Senior Software Architect (AI-assisted)
> Codebase: ~104 source files across main, renderer, shared, and MCP server

---

## Executive Summary

OpenAgentManager is a well-structured Electron application with a clean three-process architecture (main/preload/renderer), strong TypeScript typing through a centralized IPC contract, and modern tooling (electron-vite, Zustand 5, React 19, Tailwind CSS 3). The ATSF storage format and multi-workspace model demonstrate thoughtful design.

However, the review uncovered **several critical security vulnerabilities** (command injection, path traversal, environment variable injection), **race conditions** in the session and permission systems, **resource management gaps** that can lead to memory leaks and zombie processes, and **significant code duplication** in the renderer layer. The AcpClient (1252 lines) and SessionManager have grown into god objects that violate single-responsibility principles.

**Health Grade: B-** -- Solid foundation with urgent security and reliability fixes needed.

| Category | Score | Notes |
|----------|-------|-------|
| Type Safety | A- | Strong IPC contract, minor `as` cast abuse in MCP server |
| Architecture | B | Clean separation, but god objects emerging |
| Security | D+ | Multiple injection vectors, missing input validation |
| Error Handling | C | Inconsistent patterns, silent failures |
| Performance | B- | Missing memoization, unbounded buffers |
| Maintainability | C+ | Heavy code duplication, 660-line components |

---

## Critical Issues (P0)

These require immediate attention -- security vulnerabilities and data integrity risks.

### P0-1: Command Injection in `workspace:open-in-vscode`

**File:** `src/main/ipc/workspace-handlers.ts`

Direct string interpolation into a shell command. A crafted workspace path can execute arbitrary commands.

**Before:**
```typescript
ipcMain.handle('workspace:open-in-vscode', async (_event, { path }: { path: string }) => {
  exec(`code "${path}"`)
})
```

**After:**
```typescript
import { execFile } from 'child_process'

ipcMain.handle('workspace:open-in-vscode', async (_event, { path }: { path: string }) => {
  // execFile does NOT spawn a shell, so path cannot break out
  execFile('code', [path], (err) => {
    if (err) logger.warn('Failed to open VS Code:', err.message)
  })
})
```

**Impact:** Arbitrary code execution with Electron app privileges.

---

### P0-2: Command Injection via WSL Environment Variables

**File:** `src/main/services/agent-manager.ts` (lines 229-236)

Environment variable values are interpolated into a shell command string for WSL. Newlines, backticks, or `$()` in values can break out of the quoting.

**Before:**
```typescript
const envExports = Object.entries(finalEnv)
  .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
  .join(' && ')
const innerCmd = [command, ...finalArgs].join(' ')
const fullCmd = `${envExports} && cd '${wslCwd}' && ${innerCmd}`
```

**After:**
```typescript
// Write env vars to a temp file and source it, avoiding shell interpolation
// Or use wsl.exe with --exec and pass env via --env flags
const wslArgs = ['--distribution', wslDistribution]
for (const [k, v] of Object.entries(finalEnv)) {
  // Validate key is alphanumeric + underscore only
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
    throw new Error(`Invalid environment variable name: ${k}`)
  }
  wslArgs.push('--env', `${k}=${v}`)  // wsl.exe --env handles escaping
}
wslArgs.push('--cd', wslCwd, '--', command, ...finalArgs)

const proc = spawn('wsl.exe', wslArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
```

**Impact:** Arbitrary command execution on WSL via malicious environment values.

---

### P0-3: Environment Variable Injection via `extraEnv`

**File:** `src/main/ipc/agent-handlers.ts` (line 30), `src/main/services/agent-manager.ts` (lines 203-204)

The renderer can pass arbitrary environment variables that are merged directly into the agent's process environment, including dangerous variables like `LD_PRELOAD`, `NODE_OPTIONS`, or `PATH`.

**Before:**
```typescript
if (extraEnv) {
  Object.assign(finalEnv, extraEnv)
}
```

**After:**
```typescript
const ENV_BLOCKLIST = new Set([
  'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS', 'NODE_DEBUG', 'PATH', 'HOME', 'SHELL',
  'ELECTRON_RUN_AS_NODE', 'ELECTRON_ENABLE_LOGGING',
])

if (extraEnv) {
  for (const [key, value] of Object.entries(extraEnv)) {
    if (ENV_BLOCKLIST.has(key.toUpperCase())) {
      logger.warn(`Blocked dangerous environment variable: ${key}`)
      continue
    }
    finalEnv[key] = value
  }
}
```

**Impact:** Arbitrary code execution via library injection or Node.js flag manipulation.

---

### P0-4: Path Traversal in File Read Operations

**Files:** `src/main/ipc/file-handlers.ts`, `src/main/services/file-service.ts`

No path validation on `file:read` or `file:read-tree` IPC channels. The renderer can read any file on the filesystem.

**Before:**
```typescript
ipcMain.handle('file:read', async (_event, { filePath }: { filePath: string }) => {
  return fileService.readFile(filePath)
})
```

**After:**
```typescript
import path from 'path'

function isPathWithin(filePath: string, allowedDir: string): boolean {
  const resolved = path.resolve(filePath)
  const resolvedDir = path.resolve(allowedDir)
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir
}

ipcMain.handle('file:read', async (_event, { filePath }: { filePath: string }) => {
  // Validate path is within an active workspace or worktree
  const allowedPaths = workspaceService.getAllPaths() // workspace dirs + worktree dirs
  const isAllowed = allowedPaths.some(dir => isPathWithin(filePath, dir))
  if (!isAllowed) {
    throw new Error('Access denied: path is outside allowed directories')
  }
  return fileService.readFile(filePath)
})
```

**Impact:** Information disclosure -- sensitive system files, credentials, private keys.

---

### P0-5: Permission Request Race Condition (Double Resolution)

**File:** `src/main/services/acp-client.ts` (lines 1016-1027)

The permission timeout and manual resolution can fire concurrently, resolving the same promise twice.

**Before:**
```typescript
const responsePromise = new Promise<PermissionResponse>((resolve) => {
  this.permissionResolvers.set(requestId, resolve)
  setTimeout(() => {
    if (this.permissionResolvers.has(requestId)) {
      this.permissionResolvers.delete(requestId)
      resolve({ requestId, optionId: '__cancelled__' })
    }
  }, 5 * 60 * 1000)
})
```

**After:**
```typescript
const responsePromise = new Promise<PermissionResponse>((resolve) => {
  let settled = false
  const safeResolve = (response: PermissionResponse) => {
    if (settled) return
    settled = true
    this.permissionResolvers.delete(requestId)
    resolve(response)
  }
  this.permissionResolvers.set(requestId, safeResolve)
  setTimeout(() => {
    safeResolve({ requestId, optionId: '__cancelled__' })
  }, 5 * 60 * 1000)
})
```

**Impact:** Unhandled promise rejection or stale permission state causing agent lockup.

---

### P0-6: Shell Injection in Download Service

**File:** `src/main/services/download-service.ts` (lines 76-86)

Shell command construction for archive extraction uses string interpolation.

**Before:**
```typescript
execSync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`)
```

**After:**
```typescript
import { execFileSync } from 'child_process'

execFileSync('powershell', [
  '-NoProfile', '-NonInteractive', '-command',
  'Expand-Archive',
  '-Path', archivePath,
  '-DestinationPath', extractDir,
  '-Force'
])
```

**Impact:** Arbitrary code execution if archive path contains PowerShell metacharacters.

---

### P0-7: MCP Server Error Message Disclosure

**File:** `src/main/mcp/internal-api.ts` (lines 287-290)

Raw error messages (potentially containing file paths, stack traces, internal state) are returned to HTTP clients.

**Before:**
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`MCP API error [${req.url}]:`, message)
  sendJson(res, 500, { error: message })
}
```

**After:**
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`MCP API error [${req.url}]:`, message)
  // Return generic error to client, keep details server-side
  sendJson(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' })
}
```

**Impact:** Information disclosure to external tools calling the MCP API.

---

## Recommended Refactorings (P1)

Structural changes to improve long-term maintenance, reliability, and scalability.

### P1-1: Break Up God Objects (AcpClient, SessionManager)

**AcpClient** at 1252 lines handles JSON-RPC transport, terminal management, file serving, and permission handling. **SessionManager** manages creation, worktrees, hooks, persistence, and title generation.

**Proposed extraction:**

```
AcpClient (1252 lines)
  -> JsonRpcTransport      - protocol encoding/decoding, request/response matching
  -> AgentTerminalServer   - terminal process lifecycle, output buffering
  -> AgentFileServer       - read/write/list file operations with path validation
  -> PermissionHandler     - permission request/response lifecycle

SessionManager
  -> SessionCreator        - creation pipeline (agent launch, worktree, hooks)
  -> TitleGenerator        - LLM-based title generation (own agent lifecycle)
  -> SessionPersistence    - thread store read/write, rehydration
```

**Benefits:** Each class < 300 lines, independently testable, clear dependency graph.

---

### P1-2: Add Input Validation Layer

No IPC handler validates its arguments. Create a lightweight validation middleware.

**Proposed pattern:**
```typescript
// src/main/ipc/validate.ts
import { z } from 'zod' // or hand-rolled validators

type ValidatedHandler<S extends z.ZodType, R> = (event: IpcMainInvokeEvent, data: z.infer<S>) => Promise<R>

function validated<S extends z.ZodType, R>(schema: S, handler: ValidatedHandler<S, R>) {
  return async (event: IpcMainInvokeEvent, data: unknown): Promise<R> => {
    const parsed = schema.parse(data)  // throws ZodError with safe message
    return handler(event, parsed)
  }
}

// Usage in session-handlers.ts:
const promptSchema = z.object({
  sessionId: z.string().uuid(),
  content: z.array(contentBlockSchema),
  mode: z.enum(['ask', 'code', 'plan', 'act']).optional(),
})

ipcMain.handle('session:prompt', validated(promptSchema, async (_event, data) => {
  return sessionManager.prompt(data.sessionId, data.content, data.mode)
}))
```

**Benefits:** Defense-in-depth, catches malformed data at the boundary, self-documenting contracts.

---

### P1-3: Introduce Dependency Injection for Services

Services currently import each other directly, creating tight coupling and making testing impossible without mocking modules.

**Before (current pattern):**
```typescript
// session-manager.ts
import { agentManager } from './agent-manager'
import { gitService } from './git-service'
import { threadStore } from './thread-store'

class SessionManager {
  async createSession() {
    const conn = await agentManager.launch(...)  // hard dependency
  }
}
```

**After (constructor injection):**
```typescript
// session-manager.ts
class SessionManager {
  constructor(
    private agents: AgentManager,
    private git: GitService,
    private threads: ThreadStore,
  ) {}

  async createSession() {
    const conn = await this.agents.launch(...)
  }
}

// service-container.ts (composition root)
const agents = new AgentManager()
const git = new GitService()
const threads = new ThreadStore()
const sessions = new SessionManager(agents, git, threads)

export { agents as agentManager, sessions as sessionManager, ... }
```

**Benefits:** Testable with mocks, explicit dependency graph, no circular import issues.

---

### P1-4: Fix Resource Management (Zombie Processes, Listener Leaks)

Multiple resource cleanup issues across the codebase:

| Resource | Location | Issue |
|----------|----------|-------|
| Terminal processes | `acp-client.ts` terminals map | No timeout cleanup if agent crashes |
| Event listeners | `session-manager.ts` promptListener | Multiple listeners if prompts overlap |
| Monitored connections | `session-manager.ts` monitoredConnections Set | Never pruned on termination |
| Pending requests | `acp-client.ts` pendingRequests Map | Unbounded growth without timeouts |
| Worktrees | `git-service.ts` | Orphaned if session creation fails mid-pipeline |

**Proposed fix -- Resource Tracker pattern:**
```typescript
// src/main/util/resource-tracker.ts
class ResourceTracker {
  private resources = new Map<string, { cleanup: () => void; timeoutId?: NodeJS.Timeout }>()

  track(id: string, cleanup: () => void, timeoutMs?: number): void {
    this.release(id) // clean up existing if any
    const entry: { cleanup: () => void; timeoutId?: NodeJS.Timeout } = { cleanup }
    if (timeoutMs) {
      entry.timeoutId = setTimeout(() => {
        logger.warn(`Resource ${id} timed out, forcing cleanup`)
        this.release(id)
      }, timeoutMs)
    }
    this.resources.set(id, entry)
  }

  release(id: string): void {
    const entry = this.resources.get(id)
    if (entry) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId)
      try { entry.cleanup() } catch (e) { logger.warn(`Cleanup failed for ${id}:`, e) }
      this.resources.delete(id)
    }
  }

  releaseAll(): void {
    for (const id of this.resources.keys()) this.release(id)
  }
}
```

---

### P1-5: Extract Shared Renderer Utilities (Eliminate Duplication)

Heavy code duplication across renderer components:

| Duplicated Logic | Locations | Lines Duplicated |
|-----------------|-----------|-----------------|
| `isInteractionMode()` validator | Sidebar, WorkspaceSection, NewThreadDialog, DraftThreadView | ~3 lines x 4 |
| `statusDotColors` mapping | WorkspaceSection, ThreadList | ~10 lines x 2 |
| Workspace defaults loading | Sidebar, WorkspaceSection, NewThreadDialog, DraftThreadView | ~15 lines x 4 |
| Document click-outside handler | PromptInput, MainPanel, WorkspaceSection | ~12 lines x 3 |

**Proposed extractions:**

```typescript
// src/renderer/lib/session-utils.ts
export const statusDotColors: Record<SessionStatus, string> = {
  initializing: 'bg-yellow-400',
  creating: 'bg-yellow-400',
  active: 'bg-green-400',
  prompting: 'bg-blue-400 animate-pulse',
  idle: 'bg-gray-400',
  cancelled: 'bg-orange-400',
  error: 'bg-red-400',
}

export function isInteractionMode(value: string): value is InteractionMode {
  return ['ask', 'code', 'plan', 'act'].includes(value)
}

// src/renderer/hooks/useWorkspaceDefaults.ts
export function useWorkspaceDefaults(workspacePath: string | undefined) {
  const [defaults, setDefaults] = useState<WorkspaceDefaults>({})
  useEffect(() => {
    if (!workspacePath) return
    window.api.invoke('workspace:get-config', { workspacePath }).then((config) => {
      if (config?.defaults) setDefaults(config.defaults)
    })
  }, [workspacePath])
  return defaults
}

// src/renderer/hooks/useClickOutside.ts
export function useClickOutside(ref: RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onClose])
}
```

---

### P1-6: Split WorkspaceSection Component (660 Lines)

`WorkspaceSection.tsx` handles workspace display, thread listing, context menus, rename editing, title generation, forking, and deletion confirmation.

**Proposed split:**

```
WorkspaceSection (660 lines)
  -> WorkspaceHeader       - collapse toggle, name, action buttons
  -> ThreadItem            - single thread row with status dot, title, actions
  -> ThreadContextMenu     - right-click menu with rename/fork/delete options
  -> useWorkspaceActions   - hook for rename, title generation, fork, delete logic
```

Each sub-component would be < 150 lines and independently testable.

---

### P1-7: Add Error Boundaries to Renderer

The app renders all top-level components without error boundaries. A crash in any message bubble, tool call card, or diff viewer takes down the entire UI.

**Before:**
```tsx
// App.tsx
<AppLayout />
<AgentBrowser />
<SettingsDialog />
<PermissionDialog />
```

**After:**
```tsx
// App.tsx
<ErrorBoundary fallback={<AppCrashFallback />}>
  <AppLayout />
</ErrorBoundary>
<ErrorBoundary fallback={null}>
  <AgentBrowser />
</ErrorBoundary>
<ErrorBoundary fallback={null}>
  <SettingsDialog />
</ErrorBoundary>

// ThreadView.tsx - granular boundary around each message
{messages.map((msg) => (
  <ErrorBoundary key={msg.id} fallback={<MessageRenderError messageId={msg.id} />}>
    <MessageBubble message={msg} ... />
  </ErrorBoundary>
))}
```

The existing `ErrorBoundary` component in `src/renderer/components/common/ErrorBoundary.tsx` exists but is not used in critical locations.

---

### P1-8: Implement Proper Logging Infrastructure

**File:** `src/main/util/logger.ts`

The current logger writes everything to stdout with no severity levels. Errors and warnings are indistinguishable from info messages.

**Before:**
```typescript
// logger.ts - everything goes to console.log
export const logger = {
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  warn: (...args: unknown[]) => console.log('[WARN]', ...args),
  error: (...args: unknown[]) => console.log('[ERROR]', ...args),
}
```

**After:**
```typescript
export const logger = {
  info: (...args: unknown[]) => console.log(timestamp(), '[INFO]', ...args),
  warn: (...args: unknown[]) => console.warn(timestamp(), '[WARN]', ...args),
  error: (...args: unknown[]) => console.error(timestamp(), '[ERROR]', ...args),
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) console.log(timestamp(), '[DEBUG]', ...args)
  },
}

function timestamp(): string {
  return new Date().toISOString()
}
```

Additionally, `AcpClient` logs full JSON-RPC messages (lines 546, 581, 641) which can spam logs with large payloads and potentially expose sensitive data. These should be truncated and redacted.

---

### P1-9: Add Cancellation Support to Session Initialization

**File:** `src/renderer/stores/session-store.ts` (lines 612-679)

The `runInitPipeline` function manages complex async initialization but cannot be cancelled. If a user discards a session during initialization, the pipeline continues consuming resources.

**Proposed fix:**
```typescript
// Track active pipelines
private initControllers = new Map<string, AbortController>()

async runInitPipeline(sessionId: string) {
  // Cancel any existing pipeline for this session
  this.initControllers.get(sessionId)?.abort()

  const controller = new AbortController()
  this.initControllers.set(sessionId, controller)

  try {
    // Check cancellation between each async step
    if (controller.signal.aborted) return

    await this.launchAgent(sessionId)
    if (controller.signal.aborted) return

    await this.createWorktree(sessionId)
    if (controller.signal.aborted) return

    await this.runHooks(sessionId)
  } finally {
    this.initControllers.delete(sessionId)
  }
}
```

---

### P1-10: Fix MCP Server CORS and Auth

**File:** `src/main/mcp/internal-api.ts`

Two issues with the HTTP API:

1. **CORS misconfiguration** (line 255): `Access-Control-Allow-Origin: 127.0.0.1` is missing protocol/port
2. **Static auth token** never rotates during app lifetime

**Before:**
```typescript
res.setHeader('Access-Control-Allow-Origin', '127.0.0.1')
```

**After:**
```typescript
// CORS should specify full origin or omit it entirely for localhost-only
// Since we already restrict to 127.0.0.1 via host check, deny cross-origin entirely:
res.setHeader('Access-Control-Allow-Origin', `http://127.0.0.1:${port}`)
```

For token rotation, regenerate the token periodically or on each app restart (current behavior on restart is fine, but document it).

---

## Minor Improvements (P2)

Quick wins, performance tuning, and code cleanup.

### P2-1: Add Missing Memoization in Renderer

**Sidebar.tsx** -- workspace sort on every render:
```typescript
// Before (line 25-27):
const sortedWorkspaces = [...workspaces].sort(...)

// After:
const sortedWorkspaces = useMemo(
  () => [...workspaces].sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt)),
  [workspaces]
)
```

**MessageBubble.tsx** -- Map reconstruction on every render (lines 180-187):
```typescript
// Before:
const toolCallMap = new Map((message.toolCalls || []).map(tc => [tc.toolCallId, tc]))

// After:
const toolCallMap = useMemo(
  () => new Map((message.toolCalls || []).map(tc => [tc.toolCallId, tc])),
  [message.toolCalls]
)
```

**PromptInput.tsx** -- `availableCommands` memo invalidates too broadly:
```typescript
// Before:
const availableCommands = useMemo(() => acpState?.commands ?? [], [acpState])

// After:
const commands = acpState?.commands
const availableCommands = useMemo(() => commands ?? [], [commands])
```

---

### P2-2: Replace Mutable Set in Workspace Store

**File:** `src/renderer/stores/workspace-store.ts`

Zustand stores should use immutable data. `Set<string>` can cause lost updates and DevTools incompatibility.

**Before:**
```typescript
expandedWorkspaceIds: new Set<string>()
```

**After:**
```typescript
expandedWorkspaceIds: {} as Record<string, boolean>

// Toggle:
set((state) => ({
  expandedWorkspaceIds: {
    ...state.expandedWorkspaceIds,
    [id]: !state.expandedWorkspaceIds[id]
  }
}))
```

---

### P2-3: Consolidate Event Listener Cleanup in PromptInput

**File:** `src/renderer/components/thread/PromptInput.tsx` (lines 206-233)

Two separate `useEffect` hooks manage document click listeners for mode menu and command menu.

**Before:**
```typescript
useEffect(() => {
  if (!modeMenuOpen) return
  const handler = (e: MouseEvent) => { ... }
  document.addEventListener('mousedown', handler)
  return () => document.removeEventListener('mousedown', handler)
}, [modeMenuOpen])

useEffect(() => {
  if (!commandMenuOpen) return
  const handler = (e: MouseEvent) => { ... }
  document.addEventListener('mousedown', handler)
  return () => document.removeEventListener('mousedown', handler)
}, [commandMenuOpen])
```

**After:**
```typescript
useEffect(() => {
  if (!modeMenuOpen && !commandMenuOpen) return
  const handler = (e: MouseEvent) => {
    if (modeMenuOpen && modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
      setModeMenuOpen(false)
    }
    if (commandMenuOpen && cmdMenuRef.current && !cmdMenuRef.current.contains(e.target as Node)) {
      setCommandMenuOpen(false)
    }
  }
  document.addEventListener('mousedown', handler)
  return () => document.removeEventListener('mousedown', handler)
}, [modeMenuOpen, commandMenuOpen])
```

---

### P2-4: Add Markdown Sanitization

**File:** `src/renderer/components/thread/MessageBubble.tsx`

`react-markdown` prevents XSS by default but doesn't validate link `href` protocols. A malicious agent response could inject `javascript:` URLs.

```typescript
// After:
import rehypeSanitize from 'rehype-sanitize'

<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight, rehypeSanitize]}
>
  {block.text}
</ReactMarkdown>
```

---

### P2-5: Add Return Values to Fire-and-Forget Handlers

Several IPC handlers don't return success/failure, making it impossible for the renderer to confirm operations completed.

**Files:** `agent-handlers.ts`, `workspace-handlers.ts`

```typescript
// Before:
ipcMain.handle('agent:uninstall', async (_event, { agentId }) => {
  agentManager.uninstall(agentId)  // no return, no await
})

// After:
ipcMain.handle('agent:uninstall', async (_event, { agentId }) => {
  await agentManager.uninstall(agentId)
  return { success: true }
})
```

---

### P2-6: Implement Exponential Backoff in Git Retry Logic

**File:** `src/main/services/git-service.ts` (lines 75-92)

Retry logic uses a fixed delay.

**Before:**
```typescript
await new Promise(resolve => setTimeout(resolve, delayMs))
```

**After:**
```typescript
await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt)))
```

---

### P2-7: Add Numeric Validation to Terminal Handlers

**File:** `src/main/ipc/terminal-handlers.ts`

```typescript
// Before:
terminalService.resize(terminalId, cols, rows)

// After:
const safeCols = Math.max(1, Math.min(500, Math.floor(cols)))
const safeRows = Math.max(1, Math.min(200, Math.floor(rows)))
terminalService.resize(terminalId, safeCols, safeRows)
```

---

### P2-8: Add MCP Permission Validation

**File:** `src/main/mcp/internal-api.ts` (lines 156-162)

The permission response endpoint doesn't validate that the request ID is actually pending or that the option ID is valid.

```typescript
// After:
'/api/session/permission-response': async (body) => {
  const { requestId, optionId } = body as { requestId: string; optionId: string }
  const pending = sessionManager.listPendingPermissions()
  const match = pending.find(p => p.requestId === requestId)
  if (!match) {
    return { error: 'No pending permission with that requestId' }
  }
  const validOption = match.options.some(o => o.optionId === optionId)
  if (!validOption) {
    return { error: 'Invalid optionId for this permission request' }
  }
  sessionManager.resolvePermission({ requestId, optionId })
  return { success: true }
}
```

---

### P2-9: Improve Accessibility

- Add `aria-label` to icon-only buttons in sidebar (collapse toggles, action buttons)
- Add `aria-selected` and `role="option"` to command menu items in PromptInput
- Add `role="tree"` and `role="treeitem"` to file explorer nodes
- Replace `setTimeout(() => ref.current?.select(), 0)` with `useLayoutEffect` for focus management

---

### P2-10: Clean Up Circular Dependency Workaround

**File:** `src/main/services/thread-store.ts` (lines 36-40)

The `setWorkspaceResolver()` function is a fragile workaround for circular imports.

```typescript
// Current:
let workspaceResolver: ((id: string) => WorkspaceInfo | undefined) | null = null
export function setWorkspaceResolver(fn: (id: string) => WorkspaceInfo | undefined) {
  workspaceResolver = fn
}

// Better: Use lazy import or service locator
export class ThreadStore {
  private getWorkspace: () => WorkspaceService

  constructor(workspaceProvider: () => WorkspaceService) {
    this.getWorkspace = workspaceProvider
  }
}

// In composition root:
const threadStore = new ThreadStore(() => workspaceService)
```

---

## Action Plan

Suggested order of operations, grouped into sprints:

### Sprint 1: Security Hardening (1-2 days)
1. **P0-1** Fix command injection in `open-in-vscode` (5 min)
2. **P0-3** Add environment variable blocklist (15 min)
3. **P0-4** Add path traversal protection to file handlers (30 min)
4. **P0-6** Fix shell injection in download service (10 min)
5. **P0-7** Sanitize MCP error responses (5 min)
6. **P0-2** Fix WSL command construction (1 hr)
7. **P1-10** Fix CORS header (5 min)

### Sprint 2: Race Conditions & Resource Leaks (1-2 days)
1. **P0-5** Fix permission double-resolution race (15 min)
2. **P1-4** Implement ResourceTracker for terminal processes and pending requests (2 hr)
3. **P1-9** Add cancellation to session init pipeline (1 hr)
4. **P2-5** Add return values to fire-and-forget handlers (30 min)

### Sprint 3: Renderer Quality (2-3 days)
1. **P1-5** Extract shared utilities (statusDotColors, isInteractionMode, hooks) (1 hr)
2. **P1-6** Split WorkspaceSection into sub-components (2 hr)
3. **P1-7** Add Error Boundaries at critical render points (1 hr)
4. **P2-1** Add missing memoization (30 min)
5. **P2-2** Replace mutable Set in workspace store (15 min)
6. **P2-3** Consolidate event listeners (15 min)
7. **P2-4** Add rehype-sanitize to markdown rendering (10 min)

### Sprint 4: Architecture (3-5 days)
1. **P1-2** Add input validation layer (Zod schemas) to IPC handlers (3 hr)
2. **P1-1** Extract AcpClient into transport/terminal/file/permission classes (4 hr)
3. **P1-3** Introduce dependency injection for services (2 hr)
4. **P1-8** Improve logging infrastructure (1 hr)
5. **P2-10** Clean up circular dependency workaround (30 min)

### Ongoing
- **P2-6** Exponential backoff in git retry (5 min)
- **P2-7** Numeric validation in terminal handlers (5 min)
- **P2-8** MCP permission validation (15 min)
- **P2-9** Accessibility improvements (1 hr)

---

## Appendix: File Reference Index

| File | Lines | Issues |
|------|-------|--------|
| `src/main/services/acp-client.ts` | ~1252 | P0-5, P1-1, P1-4 (god object, race condition, resource leaks) |
| `src/main/services/session-manager.ts` | ~545 | P1-1, P1-3, P1-4 (god object, tight coupling, listener leaks) |
| `src/main/services/agent-manager.ts` | ~330 | P0-2, P0-3 (WSL injection, env injection) |
| `src/main/services/download-service.ts` | ~89 | P0-6 (shell injection) |
| `src/main/services/file-service.ts` | ~91 | P0-4 (path traversal) |
| `src/main/services/git-service.ts` | ~92 | P2-6 (fixed retry delay) |
| `src/main/services/thread-store.ts` | ~40+ | P2-10 (circular dependency) |
| `src/main/ipc/workspace-handlers.ts` | ~74 | P0-1 (command injection) |
| `src/main/ipc/agent-handlers.ts` | ~50 | P0-3, P2-5 (env injection, missing returns) |
| `src/main/ipc/file-handlers.ts` | ~14 | P0-4 (path traversal) |
| `src/main/ipc/terminal-handlers.ts` | ~25 | P2-7 (numeric validation) |
| `src/main/mcp/internal-api.ts` | ~290 | P0-7, P1-10, P2-8 (error leak, CORS, permissions) |
| `src/main/util/logger.ts` | ~18 | P1-8 (no severity routing) |
| `src/renderer/stores/session-store.ts` | ~944 | P1-9 (no cancellation) |
| `src/renderer/stores/workspace-store.ts` | ~62 | P2-2 (mutable Set) |
| `src/renderer/components/sidebar/WorkspaceSection.tsx` | ~660 | P1-6 (god component) |
| `src/renderer/components/thread/MessageBubble.tsx` | ~254 | P2-1, P2-4 (memoization, markdown XSS) |
| `src/renderer/components/thread/PromptInput.tsx` | ~305 | P2-1, P2-3 (memoization, listeners) |
| `src/renderer/components/layout/Sidebar.tsx` | ~209 | P2-1 (memoization) |
| `src/renderer/components/layout/MainPanel.tsx` | ~199 | P1-5 (duplication) |
| `src/renderer/App.tsx` | ~92 | P1-7 (missing error boundaries) |
