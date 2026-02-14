# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenAgentManager is an Electron desktop app that connects to any ACP (Agent Client Protocol) compatible AI coding agent. It spawns agents as child processes communicating over JSON-RPC 2.0 via stdio.

## Commands

```bash
npm run dev              # Start dev mode with hot reload
npm run build            # Production build (electron-vite)
npm run typecheck        # Type check both main + renderer
npm run typecheck:node   # Type check main process only (tsconfig.node.json)
npm run typecheck:web    # Type check renderer only (tsconfig.web.json)
npm run lint             # ESLint (.ts, .tsx)
npm run dist             # Build + package for all platforms
```

No test framework is configured. There are no tests.

## Architecture

**Three-process Electron app** built with electron-vite:

1. **Main process** (`src/main/`) — Node.js backend: services, IPC handlers, child process management
2. **Preload** (`src/preload/index.ts`) — Context bridge exposing typed `window.api`
3. **Renderer** (`src/renderer/`) — React 19 UI with Zustand 5 state management

### IPC Contract

All IPC is typed through a single contract in `src/shared/types/ipc.ts`:
- `IpcChannels` — request/response pairs for `ipcMain.handle`/`ipcRenderer.invoke`
- `IpcEvents` — one-way main→renderer notifications (streaming updates, status changes)
- `ElectronAPI` — typed interface exposed via `window.api` in preload

To add a new IPC channel: add the type to `IpcChannels`, create the handler in `src/main/ipc/`, register it in `src/main/ipc/index.ts`, and call via `window.api.invoke()` from the renderer.

### Services (Main Process)

Singleton classes in `src/main/services/`, exported as instantiated constants (e.g., `export const agentManager = new AgentManager()`). Key services:

- **AgentManager** — install/spawn/terminate agents, ACP handshake
- **SessionManager** — multi-session orchestration, worktree creation, prompt routing
- **AcpClient** — raw JSON-RPC 2.0 over stdio, handles streaming `session/update` notifications
- **GitService** — `simple-git` wrapper for worktree CRUD, diff, commit
- **SettingsService** — `electron-store` wrapper for persistent app settings
- **WorkspaceService** — multi-workspace management (replaces old single-project model)

### State Management (Renderer)

Zustand stores in `src/renderer/stores/` using `create<State>()`. Components subscribe to IPC events via `useIpcEvent()` hook in `App.tsx`, which updates stores. Data flow:

```
Component → store action → window.api.invoke() → IPC handler → service
Service emits event → mainWindow.webContents.send() → useIpcEvent() → store update → re-render
```

### Styling

Tailwind CSS 3 with custom theme tokens defined as CSS variables in `src/renderer/globals.css`:
- Surfaces: `bg-surface-0` (darkest) through `bg-surface-3`
- Text: `text-text-primary`, `text-text-secondary`, `text-text-muted`
- Accent: `bg-accent`, `hover:bg-accent-hover`
- Semantic: `text-success`, `text-warning`, `text-error`

## TypeScript Configuration

Two tsconfig files referenced from root `tsconfig.json`:
- `tsconfig.node.json` — main process + preload (Node.js target)
- `tsconfig.web.json` — renderer (browser target)

Path aliases (configured in both tsconfig and `electron.vite.config.ts`):
- `@shared` → `src/shared`
- `@renderer` → `src/renderer`

## Data Persistence

App data stored under Electron's `userData` path:
- `agents/` — installed agent binaries
- `sessions/` — persisted thread metadata (via `thread-store.ts`)
- `worktrees/` — git worktrees for isolated sessions
- `cache/` — registry.json cache
- Settings via `electron-store` (auto-managed JSON files)

## Multi-Workspace Model

Workspaces group threads by directory. Each thread (session) belongs to a workspace and optionally gets its own git worktree. The `session-store` bridges to the legacy `project-store` for backward compatibility.
