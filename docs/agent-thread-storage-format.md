# Agent Thread Storage Format (ATSF) v1.1

An open, filesystem-based specification for persisting AI agent conversation threads within a project directory.

## Goals

- **Agent-agnostic**: Works with any AI coding agent (ACP, MCP, Claude Code, Copilot, Cursor, etc.)
- **Tool-agnostic**: Any application can read/write these files
- **Git-friendly**: Plain text JSON, deterministic ordering, sensible `.gitignore` defaults
- **Resumable**: Contains all information needed to restore a conversation
- **Concurrent**: Multiple threads can coexist in the same project

## Directory Layout

```
<project-root>/
  .agent/
    config.json                          # Project-level agent configuration (optional)
    .gitignore                           # Default ignore rules
    threads/
      <thread-id>/
        thread.json                      # Thread metadata envelope
        messages.jsonl                   # Append-only message log
        assets/                          # Binary content (images, attachments)
          <hash>.<ext>
```

### Worktree-Local Storage

When a thread runs inside a **git worktree**, its `.agent/` data SHOULD be stored inside that worktree directory rather than in the main project root. This makes each worktree self-contained: the code and the conversation that produced it live together.

```
<worktree-dir>/                          # e.g. worktrees/myapp/thread-a1b2c3d4
  .agent/
    config.json
    .gitignore
    threads/
      <thread-id>/
        thread.json
        messages.jsonl
        assets/
  src/
  ...
```

Non-worktree threads continue to be stored under the main project root's `.agent/` directory.

Implementations that scan for threads SHOULD check both the main project `.agent/` directory and the `.agent/` directories inside any known worktrees belonging to that project.

### Naming Conventions

- **Thread IDs**: UUID v4 or any unique string. Directory name = thread ID.
- **Asset filenames**: `sha256-<first16hex>.<ext>` (content-addressable).

## Spec Versioning

Version is declared in `config.json` and each `thread.json` via `"specVersion": "1.1"`.

Numbering follows `MAJOR.MINOR`:
- **MAJOR** increment = breaking schema change. Readers of version N cannot safely read version N+1.
- **MINOR** increment = backward-compatible additions (new optional fields).

Implementations MUST reject threads with a higher MAJOR version than they support. They SHOULD preserve unknown fields when round-tripping.

## File Schemas

### `config.json` - Project-Level Configuration

Optional. Provides defaults for all threads in the project.

```json
{
  "specVersion": "1.1",
  "createdBy": {
    "name": "MyAgentApp",
    "version": "1.0.0"
  },
  "defaults": {
    "agentId": "claude-code",
    "useWorktree": true
  },
  "agentSettings": {
    "claude-code": {
      "model": "sonnet"
    }
  },
  "worktreeHooks": {
    "symlinks": [
      { "source": ".env.local" },
      { "source": "node_modules" }
    ],
    "postSetupCommands": [
      { "command": "npm install", "label": "Installing dependencies", "timeout": 300000 }
    ],
    "initialPrompt": "Read CONTRIBUTING.md and suggest what to work on next."
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `specVersion` | string | Yes | Spec version (e.g. `"1.1"`) |
| `createdBy` | object | No | Application that created this directory |
| `createdBy.name` | string | Yes* | Application name |
| `createdBy.version` | string | Yes* | Application version |
| `defaults` | object | No | Default settings for new threads |
| `defaults.agentId` | string | No | Preferred agent identifier |
| `defaults.interactionMode` | string | No | e.g. `"code"`, `"ask"`, `"plan"` |
| `defaults.useWorktree` | boolean | No | Whether to use git worktrees |
| `agentSettings` | object | No | Per-agent non-secret configuration |
| `worktreeHooks` | object | No | Hooks executed when a git worktree is created (v1.1+) |

**Security**: This file MUST NOT contain secrets (API keys, tokens). Secrets belong in the application's own secure storage.

#### `worktreeHooks` — Worktree Setup Hooks (v1.1+)

When an application creates a git worktree for a new thread, these hooks define automatic setup steps. All fields are optional.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `worktreeHooks.symlinks` | array | No | Symlinks to create in the worktree |
| `worktreeHooks.symlinks[].source` | string | Yes* | Path relative to original repo root |
| `worktreeHooks.symlinks[].target` | string | No | Path relative to worktree root (defaults to `source`) |
| `worktreeHooks.postSetupCommands` | array | No | Shell commands to run in the worktree after creation |
| `worktreeHooks.postSetupCommands[].command` | string | Yes* | Shell command to execute |
| `worktreeHooks.postSetupCommands[].label` | string | No | Human-readable label |
| `worktreeHooks.postSetupCommands[].timeout` | number | No | Timeout in ms (default: 120000) |
| `worktreeHooks.postSetupCommands[].continueOnError` | boolean | No | Continue on failure (default: false) |
| `worktreeHooks.postSetupCommands[].platforms` | string[] | No | Platform filter: `"win32"`, `"darwin"`, `"linux"` |
| `worktreeHooks.initialPrompt` | string | No | Prompt auto-sent to the agent after session creation |

**Symlinks**: Implementations SHOULD use junctions for directories on Windows (no admin privileges required). The `source` path must exist in the original repository. If `target` is omitted, the symlink is created at the same relative path in the worktree.

**Post-setup commands**: Commands run sequentially in the worktree directory with `shell: true`. If a command fails and `continueOnError` is false (the default), remaining commands are skipped. The `platforms` field allows platform-specific commands (e.g., `chmod` only on Linux/macOS).

**Initial prompt**: The prompt text is sent to the agent as the first user message after session creation. This is useful for providing context or instructions specific to the worktree workflow.

**Error handling**: Implementations SHOULD treat hook failures as non-fatal. A failing hook MUST NOT prevent session creation.

### `thread.json` - Thread Metadata Envelope

Each thread directory contains exactly one `thread.json`.

```json
{
  "specVersion": "1.0",
  "threadId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "title": "Fix authentication bug",
  "createdAt": "2025-02-14T10:30:00.000Z",
  "updatedAt": "2025-02-14T11:45:00.000Z",
  "agent": {
    "id": "claude-code",
    "name": "Claude Code",
    "version": "1.0.0",
    "protocol": "acp",
    "protocolVersion": 1
  },
  "context": {
    "workingDir": "/home/user/projects/myapp",
    "relativeDir": ".",
    "gitBranch": "main",
    "gitCommit": "abc123def456",
    "worktree": {
      "path": "/home/user/.local/share/agentmanager/worktrees/myapp/thread-a1b2c3d4",
      "branch": "am-a1b2c3d4"
    }
  },
  "stats": {
    "messageCount": 12,
    "userMessageCount": 5,
    "agentMessageCount": 7,
    "toolCallCount": 23
  },
  "metadata": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `specVersion` | string | Yes | Spec version |
| `threadId` | string | Yes | Unique thread identifier |
| `title` | string | Yes | Human-readable thread title |
| `createdAt` | string | Yes | ISO 8601 creation timestamp |
| `updatedAt` | string | Yes | ISO 8601 last-message timestamp |
| `agent` | object | Yes | Agent identification |
| `agent.id` | string | Yes | Agent registry/package ID |
| `agent.name` | string | Yes | Human-readable agent name |
| `agent.version` | string | No | Agent version at conversation time |
| `agent.protocol` | string | No | Protocol used: `"acp"`, `"mcp"`, `"custom"` |
| `agent.protocolVersion` | number | No | Protocol version number |
| `context` | object | Yes | Working directory context |
| `context.workingDir` | string | Yes | Absolute path at creation time |
| `context.relativeDir` | string | No | Path relative to project root (portability) |
| `context.gitBranch` | string | No | Git branch when thread was created |
| `context.gitCommit` | string | No | HEAD commit hash when thread was created |
| `context.worktree` | object | No | Git worktree details if used |
| `context.worktree.path` | string | Yes* | Worktree absolute path |
| `context.worktree.branch` | string | Yes* | Worktree branch name |
| `stats` | object | Yes | Message summary for fast listing |
| `stats.messageCount` | number | Yes | Total messages |
| `stats.userMessageCount` | number | Yes | User messages |
| `stats.agentMessageCount` | number | Yes | Agent messages |
| `stats.toolCallCount` | number | Yes | Total tool calls |
| `metadata` | object | No | Application-specific opaque data |

**Notes**:
- `updatedAt` and `stats` are derived from `messages.jsonl` but cached here for fast listing.
- `metadata` is an escape hatch for app-specific data. Other tools MUST preserve it when modifying a thread.

### `messages.jsonl` - Message Log

Each line is a self-contained JSON object representing one message. Lines are appended in chronological order.

```jsonl
{"id":"msg-001","role":"user","timestamp":"2025-02-14T10:30:00.000Z","content":[{"type":"text","text":"Fix the login bug in auth.ts"}]}
{"id":"msg-002","role":"agent","timestamp":"2025-02-14T10:30:15.000Z","content":[{"type":"thinking","text":"Let me look at auth.ts..."},{"type":"text","text":"I found the issue..."}],"toolCalls":[{"toolCallId":"tc-001","name":"file_read","title":"Read auth.ts","status":"completed","input":"{\"path\":\"src/auth.ts\"}","output":"...file contents..."}],"stopReason":"end_turn"}
```

#### Message Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique message ID (UUID v4) |
| `role` | string | Yes | `"user"`, `"agent"`, or `"system"` |
| `timestamp` | string | Yes | ISO 8601 timestamp |
| `content` | array | Yes | Array of content blocks |
| `toolCalls` | array | No | Tool calls made during this message |
| `stopReason` | string | No | Why the agent stopped: `"end_turn"`, `"max_tokens"`, etc. |
| `model` | string | No | Model used (e.g. `"claude-sonnet-4-5-20250929"`) |
| `tokens` | object | No | Token usage |
| `tokens.input` | number | No | Input tokens |
| `tokens.output` | number | No | Output tokens |

#### Content Block Types

**Text**:
```json
{ "type": "text", "text": "Hello world" }
```

**Thinking** (agent reasoning/chain-of-thought):
```json
{ "type": "thinking", "text": "Let me analyze this..." }
```

**Image** (references an asset file):
```json
{ "type": "image", "assetRef": "sha256-a1b2c3d4e5f6g7h8.png", "mimeType": "image/png" }
```

Unknown content block types SHOULD be preserved on round-trip and MAY be rendered as a placeholder or skipped.

#### Tool Call Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `toolCallId` | string | Yes | Unique tool call ID |
| `name` | string | Yes | Tool name (e.g. `"file_edit"`, `"bash"`) |
| `title` | string | No | Human-readable title |
| `status` | string | Yes | `"pending"`, `"running"`, `"completed"`, `"failed"` |
| `input` | string | No | Tool input (JSON string or plain text) |
| `output` | string | No | Tool output/result |
| `duration` | number | No | Execution time in milliseconds |
| `diff` | object | No | File diff if applicable |
| `diff.path` | string | Yes* | File path |
| `diff.oldText` | string | Yes* | Original text |
| `diff.newText` | string | Yes* | New text |

### Image Assets

Binary content is stored in `<thread-id>/assets/` using content-addressable naming:

```
assets/sha256-<first16hex>.<ext>
```

When a message contains inline image data (e.g., base64-encoded), implementations SHOULD:
1. Hash the decoded binary data with SHA-256
2. Write the binary to `assets/sha256-<first16hex>.<ext>`
3. Replace the inline data with `"assetRef": "sha256-<first16hex>.<ext>"` in the JSONL

This keeps message logs compact and diff-friendly.

## Default `.gitignore`

Implementations SHOULD create `.agent/.gitignore` with these defaults:

```gitignore
# Agent Thread Storage Format - default .gitignore
# Conversation threads are not committed by default.
# They can be large and may contain sensitive content.

# Ignore message logs and binary assets
threads/*/messages.jsonl
threads/*/assets/

# Thread metadata is also ignored by default.
# Uncomment the next line to track thread metadata (useful for team awareness):
# !threads/*/thread.json
```

## Concurrency

- **Thread creation**: UUID-based directory names. No coordination needed.
- **Message appending**: Only one process should write to a given `messages.jsonl` at a time. Implementations SHOULD use file locking or a lockfile when writing.
- **Thread metadata updates**: `thread.json` should be written atomically (write to temp file, then rename).
- **Cross-tool reads**: A reader can safely read `messages.jsonl` line by line. A partial last line indicates an in-progress write and should be ignored.

## Extension Points

1. **Unknown fields**: Implementations MUST preserve JSON fields they do not recognize (round-trip safety).
2. **Unknown content block types**: Renderers should skip or show a placeholder for unrecognized types.
3. **`metadata` in `thread.json`**: Application-specific opaque data. Other tools MUST preserve it.

## Compatibility Notes

- All timestamps are ISO 8601 in UTC.
- All text encoding is UTF-8.
- File paths in `context.workingDir` are absolute. Use `context.relativeDir` for portability across machines.
- The `"system"` role is available for injected context or metadata messages that are neither user nor agent-authored.
- Worktree threads store their `.agent/` data inside the worktree directory. When a worktree is removed, its thread data is removed with it. Implementations SHOULD keep a cache of thread metadata to handle this gracefully.
