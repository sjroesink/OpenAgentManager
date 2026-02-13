# OpenAgentManager

An agent-agnostic desktop coding environment that connects to any [ACP (Agent Client Protocol)](https://agentclientprotocol.com/) compatible AI coding agent. Think of it as an open alternative to the Codex desktop app — but not locked to a single AI provider.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![ACP](https://img.shields.io/badge/ACP-0.14-purple)

## What is this?

OpenAgentManager lets you:

- **Browse and install agents** from the [ACP Registry](https://agentclientprotocol.com/get-started/registry) — Claude Code, Gemini CLI, Codex CLI, GitHub Copilot, Junie, Kimi, Mistral Vibe, and more
- **Run multiple agents in parallel** across different threads/tasks
- **Optionally isolate changes with git worktrees** — each thread can get its own branch and working directory, just like Claude Code Desktop
- **Review diffs, commit changes, and use a built-in terminal** — all from one interface

The key idea: **you pick the agent, not the app**. All communication happens over the standardized ACP protocol (JSON-RPC 2.0 over stdio), so any compliant agent works out of the box.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                   OpenAgentManager                      │
│                                                         │
│  Main Process (Node.js)          Renderer (React)       │
│  ├── RegistryService             ├── Sidebar            │
│  │   └── fetch registry.json     │   ├── ThreadList     │
│  ├── AgentManager                │   ├── FileExplorer   │
│  │   ├── install (npx/binary)    │   └── AgentSelector  │
│  │   └── spawn & lifecycle       ├── MainPanel          │
│  ├── AcpClient                   │   ├── ThreadView     │
│  │   └── JSON-RPC over stdio     │   ├── MessageBubble  │
│  ├── SessionManager              │   └── PromptInput    │
│  ├── GitService                  ├── ReviewPanel        │
│  │   └── worktree CRUD           │   ├── DiffViewer     │
│  ├── TerminalService             │   └── CommitPanel    │
│  └── FileService                 └── TerminalPanel      │
│                                                         │
│  Child Processes (agents)        Stores (Zustand)       │
│  [claude-code --acp]  ── stdio   ├── agent-store        │
│  [gemini-cli  --acp]  ── stdio   ├── session-store      │
│  [codex-cli   --acp]  ── stdio   ├── project-store      │
│                                  └── ui-store           │
└────────────────────────────────────────────────────────┘
```

### How ACP works

The [Agent Client Protocol](https://agentclientprotocol.com/) standardizes how code editors talk to AI coding agents:

1. **Agent is spawned** as a child process with `--acp` flag
2. **JSON-RPC 2.0** messages flow over stdin/stdout
3. **Handshake**: `initialize` → capability exchange → optional `authenticate`
4. **Sessions**: `session/new` creates an isolated conversation context
5. **Prompts**: `session/prompt` sends user messages, agent streams back `session/update` notifications (text chunks, tool calls, thinking)
6. **Permissions**: agent requests approval for sensitive operations via `session/request_permission`

ACP sits between the editor and the agent. For tool/data access, agents use [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) underneath — the two protocols are complementary.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Git](https://git-scm.com/) (for worktree support)

### Install & Run

```bash
git clone https://github.com/sjroesink/OpenAgentManager.git
cd OpenAgentManager
npm install
npm run dev
```

### Usage

1. **Open a project** — click the folder icon in the toolbar or use the "Open Project" button
2. **Install agents** — click "Agents" in the toolbar to browse the ACP Registry
3. **Create a thread** — select an installed agent, optionally enable git worktree isolation, and click "New Thread"
4. **Start prompting** — type your message and press Enter

### Optional: Terminal support

Full terminal emulation requires `node-pty` (a native module). If you have C++ build tools installed:

```bash
npm run install:node-pty
```

## Project Structure

```
src/
├── shared/           # Types shared between main & renderer
│   ├── types/        # Agent, Session, Git, IPC, Settings, Project
│   └── constants.ts  # Registry URL, protocol version
├── main/             # Electron main process
│   ├── services/     # Core business logic
│   │   ├── acp-client.ts        # ACP JSON-RPC transport
│   │   ├── agent-manager.ts     # Install, launch, terminate agents
│   │   ├── session-manager.ts   # Multi-session orchestrator
│   │   ├── git-service.ts       # Worktree create/remove/list/diff
│   │   ├── registry-service.ts  # Fetch & cache ACP registry
│   │   ├── terminal-service.ts  # PTY management
│   │   ├── file-service.ts      # File tree & read
│   │   ├── download-service.ts  # Binary agent download/extract
│   │   └── settings-service.ts  # Persistent app settings
│   ├── ipc/          # IPC handler registration
│   └── util/         # Platform detection, paths, logging
├── preload/          # Electron context bridge (typed IPC API)
└── renderer/         # React UI
    ├── stores/       # Zustand state management
    ├── hooks/        # React hooks (IPC events)
    ├── components/   # UI components
    │   ├── layout/   # AppLayout, Toolbar, Sidebar, StatusBar
    │   ├── sidebar/  # ThreadList, FileExplorer, AgentSelector
    │   ├── thread/   # ThreadView, MessageBubble, PromptInput
    │   ├── review/   # DiffViewer, FileChangeList, CommitPanel
    │   ├── terminal/ # TerminalPanel
    │   ├── registry/ # AgentBrowser, AgentCard
    │   ├── settings/ # SettingsDialog
    │   └── common/   # Button, Badge, Dialog, Tabs, Spinner
    └── lib/          # IPC client wrapper
```

## Key Features

| Feature | Description |
|---|---|
| **ACP Registry** | Browse, search, and install agents from the central ACP agent registry |
| **Agent Agnostic** | Works with any ACP-compatible agent (Claude Code, Gemini, Codex, Copilot, etc.) |
| **Multiple Distribution Methods** | Supports npx, uvx, and binary agent installations with platform auto-detection |
| **Git Worktrees** | Optionally isolate each thread on its own branch — parallel tasks don't interfere |
| **Streaming Responses** | Real-time text, thinking blocks, and tool call display as the agent works |
| **Diff Review** | See exactly what files the agent changed, with inline diff view |
| **Commit Panel** | Stage and commit agent changes from within the app |
| **Permission System** | Approve/deny agent actions (file writes, command execution) via UI dialogs |
| **Built-in Terminal** | Per-session terminal for testing agent changes |
| **Settings** | Per-agent API keys, git worktree config, theme selection |

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Electron 33 |
| Build system | electron-vite 2 + Vite 5 |
| Frontend | React 19 + TypeScript 5.7 |
| State management | Zustand 5 |
| Styling | Tailwind CSS 3 |
| Git operations | simple-git |
| Agent protocol | ACP (JSON-RPC 2.0 over stdio) |
| Agent discovery | ACP Registry (`cdn.agentclientprotocol.com`) |
| Settings persistence | electron-store |

## Scripts

```bash
npm run dev          # Start in development mode (hot reload)
npm run build        # Production build
npm run preview      # Preview production build
npm run typecheck    # Run TypeScript type checking
```

## Contributing

Contributions are welcome! Some areas that could use help:

- [ ] Monaco Editor integration for proper diff viewing
- [ ] xterm.js integration for full terminal emulation
- [ ] Session persistence (resume previous conversations)
- [ ] MCP server configuration UI
- [ ] Agent authentication flows (OAuth, API key prompts)
- [ ] Worktree merge/cleanup workflows
- [ ] Keyboard shortcuts
- [ ] Tests (unit, integration, e2e)

## License

MIT
