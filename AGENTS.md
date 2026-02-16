# AGENTS.md

This file provides guidance for agentic coding agents working in this repository.

## Project Overview

OpenAgentManager is an Electron desktop app that connects to any [ACP (Agent Client Protocol)](https://agentclientprotocol.com/) compatible AI coding agent. It spawns agents as child processes communicating over JSON-RPC 2.0 via stdio.

### Agent Client Protocol

This project uses the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) to communicate with AI coding agents:
- **Protocol specification**: https://agentclientprotocol.com/
- **SDK**: `@agentclientprotocol/sdk` (see `package.json`)
- **Registry**: Agent discovery via `cdn.agentclientprotocol.com`
- **Reference**: Use the protocol docs at https://agentclientprotocol.com/protocol/ for session, content, and message types

## Commands

```bash
# Development
npm run dev              # Start dev mode with hot reload

# Building
npm run build            # Production build (electron-vite)
npm run build:win        # Build for Windows
npm run build:mac        # Build for macOS
npm run build:linux      # Build for Linux
npm run dist             # Build + package for all platforms

# Type Checking
npm run typecheck        # Type check both main + renderer
npm run typecheck:node   # Type check main process only
npm run typecheck:web    # Type check renderer only

# Linting
npm run lint             # ESLint (.ts, .tsx files)

# No test framework is configured
```

## Architecture

**Three-process Electron app** built with electron-vite:

1. **Main process** (`src/main/`) — Node.js backend: services, IPC handlers, child process management
2. **Preload** (`src/preload/index.ts`) — Context bridge exposing typed `window.api`
3. **Renderer** (`src/renderer/`) — React 19 UI with Zustand 5 state management

### Directory Structure

```
src/
├── main/                    # Main process (Node.js)
│   ├── ipc/               # IPC handlers (register in index.ts)
│   ├── services/          # Singleton services (AgentManager, SessionManager, etc.)
│   ├── util/              # Utilities (logger, platform, paths)
│   └── index.ts           # Entry point
├── preload/
│   └── index.ts           # Context bridge
├── renderer/              # Renderer process (React)
│   ├── components/       # React components (categorized by feature)
│   ├── stores/           # Zustand stores
│   ├── hooks/            # Custom hooks
│   └── lib/              # Client-side utilities
└── shared/               # Shared types and utilities
    └── types/            # TypeScript interfaces/types
```

## Code Style Guidelines

### TypeScript

- **Strict mode enabled** — all TypeScript code must pass strict type checking
- Use explicit types for function parameters and return types
- Prefer `interface` for public APIs and data structures
- Use `type` for unions, intersections, and computed types
- Avoid `any` — use `unknown` when type is truly unknown

### Naming Conventions

- **Files**: `kebab-case.ts` for utilities, `PascalCase.tsx` for React components, `camelCase.ts` for services/handlers
- **Classes**: `PascalCase` (e.g., `AgentManagerService`)
- **Interfaces**: `PascalCase` with `I` prefix only when necessary for disambiguation (prefer descriptive names instead)
- **Variables/Functions**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE` for true constants, `camelCase` for singleton exports
- **Boolean variables**: Use `isXxx`, `hasXxx`, `canXxx` prefixes

### Imports

**Order** (separate with blank lines):
1. External libraries (React, Zustand, etc.)
2. Path aliases (`@shared/`, `@renderer/`)
3. Relative imports from same package

```typescript
// External
import { useState, useEffect } from 'react'
import { create } from 'zustand'

// Path aliases
import type { SessionInfo } from '@shared/types/session'
import { useSessionStore } from '@renderer/stores/session-store'

// Relative - internal
import { AgentManagerService } from '../services/agent-manager'
import { logger } from '../util/logger'
```

**Use named imports** — avoid default imports for consistency:
```typescript
// Good
import { useState, useEffect } from 'react'

// Avoid
import React, { useState, useEffect } from 'react'
```

### React Components

- Use **functional components** with hooks
- Component file: `PascalCase.tsx`
- Props interface: `ComponentNameProps` defined in same file
- Destructure props in function signature
- Use `className` composition with Tailwind

```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button className={`base-classes ${className}`} {...props} />
}
```

### State Management (Zustand)

- Store files in `src/renderer/stores/` named `<feature>-store.ts`
- Use `create<State>()` factory
- Define state interface with all fields and actions
- Use `try/catch` in async actions for error handling

```typescript
interface SessionState {
  sessions: SessionInfo[]
  activeSessionId: string | null
  loadSessions: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  loadSessions: async () => {
    try {
      const sessions = await window.api.invoke('session:list')
      set({ sessions })
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }
}))
```

### Error Handling

- Use `try/catch` blocks for async operations
- Log errors with the `logger` utility in main process
- Use descriptive error messages: `throw new Error(\`Failed to X: ${reason}\`)`
- Surface user-facing errors via IPC events or store state
- Never expose internal error details to renderer without sanitization

```typescript
try {
  const result = await someAsyncOperation()
  return result
} catch (error) {
  logger.error('Operation failed', { error, context })
  throw new Error(`Operation failed: ${error instanceof Error ? error.message : 'unknown'}`)
}
```

### IPC Contract

All IPC communication is typed in `src/shared/types/ipc.ts`:
- `IpcChannels` — request/response pairs for `ipcMain.handle`/`ipcRenderer.invoke`
- `IpcEvents` — one-way main→renderer notifications

**Adding a new IPC channel**:
1. Add type to `IpcChannels` in `src/shared/types/ipc.ts`
2. Create handler in `src/main/ipc/<feature>-handlers.ts`
3. Register in `src/main/ipc/index.ts`
4. Use via `window.api.invoke()` from renderer

### Services (Main Process)

- Singleton classes exported as instantiated constants
- Files in `src/main/services/` named `<service-name>.ts`
- Export pattern: `export const serviceName = new ServiceClass()`

```typescript
// src/main/services/agent-manager.ts
export class AgentManagerService {
  // ... class implementation
}

export const agentManager = new AgentManagerService()
```

### Styling

Use **Tailwind CSS 3** with custom theme tokens from `src/renderer/globals.css`:
- Surfaces: `bg-surface-0` (darkest) to `bg-surface-3`
- Text: `text-text-primary`, `text-text-secondary`, `text-text-muted`
- Accent: `bg-accent`, `hover:bg-accent-hover`
- Semantic: `text-success`, `text-warning`, `text-error`
- Borders: `border-border`

### Logging

Use the `logger` utility from `src/main/util/logger.ts`:
```typescript
import { logger } from '../util/logger'

logger.info('Message', { context })
logger.error('Error message', { error, extra })
logger.warn('Warning message')
```

### Path Aliases

Configured in both `tsconfig.node.json` and `tsconfig.web.json`:
- `@shared/*` → `src/shared/*`
- `@renderer/*` → `src/renderer/*`

### Git Workflow

- Create feature branches for new work
- Run `npm run typecheck && npm run lint` before committing
- Commit messages should be concise and descriptive
