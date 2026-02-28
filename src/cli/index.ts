#!/usr/bin/env node

/**
 * oam — OpenAgentManager CLI
 *
 * A command-line interface for controlling the OpenAgentManager Electron app.
 * Communicates with the running app via its internal HTTP API (port discovered
 * from the app's userData directory).
 *
 * Usage: oam <command> [subcommand] [args] [--json]
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

// ============================================================
// Discovery: locate the running Electron app
// ============================================================

function getAppDataDir(): string {
  const platform = process.platform
  if (platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'agent-manager'
    )
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'agent-manager')
  } else {
    return path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
      'agent-manager'
    )
  }
}

function discover(): { port: number; token: string } {
  const dataDir = getAppDataDir()
  const portFile = path.join(dataDir, 'mcp-port')
  const tokenFile = path.join(dataDir, 'mcp-token')

  if (!fs.existsSync(portFile) || !fs.existsSync(tokenFile)) {
    die(
      'AgentManager is not running or its API is unavailable.\n' +
        `  Expected: ${portFile}\n` +
        `       and: ${tokenFile}\n` +
        '  Start AgentManager first, then retry.'
    )
  }

  const port = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10)
  const token = fs.readFileSync(tokenFile, 'utf-8').trim()

  if (isNaN(port) || !token) {
    die('Invalid API discovery files. Restart AgentManager.')
  }

  return { port, token }
}

// ============================================================
// HTTP client
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
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    const data = (await response.json()) as unknown

    if (!response.ok) {
      const errMsg = (data as { error?: string }).error || `HTTP ${response.status}`
      die(`API error: ${errMsg}`)
    }

    return data
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      die(`Request timed out after ${timeoutMs / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================
// Output helpers
// ============================================================

function die(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

interface TableColumn {
  key: string
  header: string
  width?: number
}

function printTable(rows: Record<string, unknown>[], columns: TableColumn[]): void {
  if (rows.length === 0) {
    console.log('(none)')
    return
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const maxVal = rows.reduce((max, row) => {
      const val = String(row[col.key] ?? '')
      return Math.max(max, val.length)
    }, col.header.length)
    return col.width ? Math.min(col.width, maxVal) : maxVal
  })

  // Header row
  const header = columns.map((col, i) => col.header.padEnd(widths[i])).join('  ')
  console.log(header)
  console.log(columns.map((_, i) => '-'.repeat(widths[i])).join('  '))

  // Data rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = String(row[col.key] ?? '')
        return val.length > widths[i] ? val.slice(0, widths[i] - 1) + '\u2026' : val.padEnd(widths[i])
      })
      .join('  ')
    console.log(line)
  }
}

// ============================================================
// Command context
// ============================================================

interface Ctx {
  port: number
  token: string
  json: boolean
  args: string[]
}

function api(ctx: Ctx, endpoint: string, body: Record<string, unknown> = {}, timeoutMs?: number) {
  return callApi(ctx.port, ctx.token, endpoint, body, timeoutMs)
}

// ============================================================
// Flag parser
// ============================================================

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = 'true'
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = 'true'
      }
    }
  }
  return flags
}

function positionals(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-')) i++ // skip flag value
    } else if (arg.startsWith('-') && arg.length === 2) {
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-')) i++ // skip flag value
    } else {
      result.push(arg)
    }
  }
  return result
}

// ============================================================
// health
// ============================================================

async function cmdHealth(ctx: Ctx): Promise<void> {
  const data = (await api(ctx, '/api/health')) as Record<string, unknown>
  if (ctx.json) return printJson(data)
  console.log('AgentManager is running')
  console.log(`  Workspaces : ${data.workspaceCount}`)
  console.log(`  Sessions   : ${data.sessionCount}`)
  console.log(`  Connections: ${data.connectionCount}`)
}

// ============================================================
// workspace
// ============================================================

async function cmdWorkspaceList(ctx: Ctx): Promise<void> {
  const data = (await api(ctx, '/api/workspace/list')) as Record<string, unknown>[]
  if (ctx.json) return printJson(data)
  printTable(data, [
    { key: 'id', header: 'ID', width: 14 },
    { key: 'name', header: 'NAME', width: 24 },
    { key: 'path', header: 'PATH', width: 48 }
  ])
}

async function cmdWorkspaceCreate(ctx: Ctx): Promise<void> {
  const [dirPath, name] = ctx.args
  if (!dirPath) die('Usage: oam workspace create <path> [name]')
  const data = (await api(ctx, '/api/workspace/create', { path: dirPath, name })) as Record<
    string,
    unknown
  >
  if (ctx.json) return printJson(data)
  console.log(`Created workspace: ${data.name} (${data.id})`)
  console.log(`  Path: ${data.path}`)
}

// ============================================================
// agent
// ============================================================

async function cmdAgentList(ctx: Ctx): Promise<void> {
  const data = (await api(ctx, '/api/agent/list-installed')) as Record<string, unknown>[]
  if (ctx.json) return printJson(data)
  printTable(data, [
    { key: 'agentId', header: 'AGENT ID', width: 28 },
    { key: 'name', header: 'NAME', width: 24 },
    { key: 'version', header: 'VERSION', width: 10 }
  ])
}

async function cmdAgentConnections(ctx: Ctx): Promise<void> {
  const data = (await api(ctx, '/api/agent/list-connections')) as Record<string, unknown>[]
  if (ctx.json) return printJson(data)
  printTable(data, [
    { key: 'connectionId', header: 'CONNECTION ID', width: 16 },
    { key: 'agentId', header: 'AGENT ID', width: 24 },
    { key: 'status', header: 'STATUS', width: 12 },
    { key: 'projectPath', header: 'PROJECT', width: 40 }
  ])
}

async function cmdAgentLaunch(ctx: Ctx): Promise<void> {
  const [agentId, projectPath] = ctx.args
  if (!agentId || !projectPath) die('Usage: oam agent launch <agentId> <projectPath>')
  const data = (await api(
    ctx,
    '/api/agent/launch',
    { agentId, projectPath },
    60_000
  )) as Record<string, unknown>
  if (ctx.json) return printJson(data)
  console.log(`Launched agent: ${data.agentId}`)
  console.log(`  Connection ID: ${data.connectionId}`)
  console.log(`  Status       : ${data.status}`)
}

async function cmdAgentTerminate(ctx: Ctx): Promise<void> {
  const [connectionId] = ctx.args
  if (!connectionId) die('Usage: oam agent terminate <connectionId>')
  await api(ctx, '/api/agent/terminate', { connectionId })
  if (ctx.json) return printJson({ success: true })
  console.log(`Terminated connection: ${connectionId}`)
}

// ============================================================
// session
// ============================================================

async function cmdSessionList(ctx: Ctx): Promise<void> {
  const data = (await api(ctx, '/api/session/list')) as Record<string, unknown>[]
  if (ctx.json) return printJson(data)
  printTable(data, [
    { key: 'sessionId', header: 'SESSION ID', width: 14 },
    { key: 'title', header: 'TITLE', width: 28 },
    { key: 'status', header: 'STATUS', width: 10 },
    { key: 'agentName', header: 'AGENT', width: 16 },
    { key: 'interactionMode', header: 'MODE', width: 8 },
    { key: 'messageCount', header: 'MSGS', width: 6 }
  ])
}

async function cmdSessionListPersisted(ctx: Ctx): Promise<void> {
  const data = (await api(ctx, '/api/session/list-persisted')) as Record<string, unknown>[]
  if (ctx.json) return printJson(data)
  printTable(data, [
    { key: 'sessionId', header: 'SESSION ID', width: 14 },
    { key: 'title', header: 'TITLE', width: 30 },
    { key: 'agentName', header: 'AGENT', width: 16 },
    { key: 'messageCount', header: 'MSGS', width: 6 }
  ])
}

async function cmdSessionGet(ctx: Ctx): Promise<void> {
  const [sessionId] = ctx.args
  if (!sessionId) die('Usage: oam session get <sessionId>')
  const data = await api(ctx, '/api/session/get', { sessionId })
  // Always JSON — full session object is only useful as JSON
  printJson(data)
}

async function cmdSessionCreate(ctx: Ctx): Promise<void> {
  const flags = parseFlags(ctx.args)
  const connectionId = flags['connection-id'] ?? flags['c']
  const workingDir = flags['working-dir'] ?? flags['d'] ?? process.cwd()
  const workspaceId = flags['workspace-id'] ?? flags['w']
  const useWorktree = 'worktree' in flags
  const title = flags['title'] ?? flags['t']
  const mode = flags['mode'] ?? flags['m']

  if (!connectionId) {
    die(
      'Usage: oam session create --connection-id <id> --workspace-id <id> [options]\n' +
        '  --connection-id, -c <id>   Agent connection ID (required)\n' +
        '  --workspace-id, -w <id>    Workspace ID (required)\n' +
        '  --working-dir, -d <path>   Working directory (default: cwd)\n' +
        '  --worktree                 Use git worktree isolation\n' +
        '  --title, -t <title>        Session title\n' +
        '  --mode, -m <mode>          ask | code | plan | act'
    )
  }
  if (!workspaceId) die('--workspace-id is required. Run: oam workspace list')

  const data = (await api(
    ctx,
    '/api/session/create',
    { connectionId, workingDir, workspaceId, useWorktree, title, mode },
    60_000
  )) as Record<string, unknown>
  if (ctx.json) return printJson(data)
  console.log(`Created session: ${data.sessionId}`)
  console.log(`  Title : ${data.title || '(untitled)'}`)
  console.log(`  Status: ${data.status}`)
  console.log(`  Mode  : ${data.interactionMode || '(default)'}`)
}

async function cmdSessionPrompt(ctx: Ctx): Promise<void> {
  const [sessionId, ...textParts] = ctx.args
  const text = textParts.join(' ')
  if (!sessionId || !text) die('Usage: oam session prompt <sessionId> <text...>')
  if (!ctx.json) console.error('Sending prompt (may take a while)…')
  const data = (await api(
    ctx,
    '/api/session/prompt',
    { sessionId, text },
    10 * 60_000
  )) as Record<string, unknown>
  if (ctx.json) return printJson(data)
  console.log(`Status: ${data.status}`)
  if (data.text) console.log('\n' + String(data.text))
}

async function cmdSessionCancel(ctx: Ctx): Promise<void> {
  const [sessionId] = ctx.args
  if (!sessionId) die('Usage: oam session cancel <sessionId>')
  await api(ctx, '/api/session/cancel', { sessionId })
  if (ctx.json) return printJson({ success: true })
  console.log(`Cancelled session: ${sessionId}`)
}

async function cmdSessionFork(ctx: Ctx): Promise<void> {
  const [sessionId, title] = ctx.args
  if (!sessionId) die('Usage: oam session fork <sessionId> [title]')
  const data = (await api(
    ctx,
    '/api/session/fork',
    { sessionId, title },
    60_000
  )) as Record<string, unknown>
  if (ctx.json) return printJson(data)
  console.log(`Forked to session: ${data.sessionId}`)
  console.log(`  Title: ${data.title || '(untitled)'}`)
}

async function cmdSessionRemove(ctx: Ctx): Promise<void> {
  const flags = parseFlags(ctx.args)
  const [sessionId] = positionals(ctx.args)
  if (!sessionId) die('Usage: oam session remove <sessionId> [--cleanup-worktree]')
  const cleanupWorktree = 'cleanup-worktree' in flags
  await api(ctx, '/api/session/remove', { sessionId, cleanupWorktree })
  if (ctx.json) return printJson({ success: true })
  console.log(`Removed session: ${sessionId}`)
}

async function cmdSessionPermissions(ctx: Ctx): Promise<void> {
  const data = (await api(ctx, '/api/session/pending-permissions')) as Record<string, unknown>[]
  if (ctx.json) return printJson(data)
  if (data.length === 0) {
    console.log('No pending permissions.')
    return
  }
  for (const p of data) {
    const options = (p.options as Array<{ optionId: string; label: string }>) ?? []
    console.log(`\nRequest ID : ${p.requestId}`)
    console.log(`  Session  : ${p.sessionId}`)
    console.log(`  Title    : ${p.title}`)
    console.log(`  Message  : ${p.message}`)
    console.log(`  Options  : ${options.map((o) => `${o.optionId} (${o.label})`).join(', ')}`)
  }
}

async function cmdSessionRespond(ctx: Ctx): Promise<void> {
  const [requestId, optionId] = ctx.args
  if (!requestId || !optionId) die('Usage: oam session respond <requestId> <optionId>')
  await api(ctx, '/api/session/permission-response', { requestId, optionId })
  if (ctx.json) return printJson({ success: true })
  console.log(`Responded to ${requestId}: ${optionId}`)
}

// ============================================================
// git
// ============================================================

async function cmdGitStatus(ctx: Ctx): Promise<void> {
  const [projectPath] = ctx.args
  if (!projectPath) die('Usage: oam git status <projectPath>')
  const data = (await api(ctx, '/api/git/status', { projectPath })) as Record<string, unknown>
  if (ctx.json) return printJson(data)
  console.log(`Branch: ${data.current}`)
  const files =
    (data.files as Array<{ path: string; working_dir?: string; index?: string }>) ?? []
  if (files.length === 0) {
    console.log('Working tree clean.')
  } else {
    console.log('\nChanges:')
    for (const f of files) {
      console.log(`  ${f.index ?? ' '}${f.working_dir ?? ' '}  ${f.path}`)
    }
  }
}

async function cmdGitDiff(ctx: Ctx): Promise<void> {
  const [workingDir, filePath] = ctx.args
  if (!workingDir) die('Usage: oam git diff <workingDir> [filePath]')
  const data = (await api(ctx, '/api/git/diff', { workingDir, filePath })) as Record<
    string,
    unknown
  >
  if (ctx.json) return printJson(data)
  const text = (data.diff ?? data.raw ?? JSON.stringify(data, null, 2)) as string
  console.log(text)
}

// ============================================================
// file
// ============================================================

interface TreeNode {
  name: string
  type: string
  children?: TreeNode[]
}

function printTree(nodes: TreeNode[], indent: number): void {
  for (const node of nodes) {
    const prefix = '  '.repeat(indent)
    const suffix = node.type === 'directory' ? '/' : ''
    console.log(`${prefix}${node.name}${suffix}`)
    if (node.children) printTree(node.children, indent + 1)
  }
}

async function cmdFileTree(ctx: Ctx): Promise<void> {
  const flags = parseFlags(ctx.args)
  const [dirPath] = positionals(ctx.args)
  const depth = parseInt(flags['depth'] ?? flags['d'] ?? '3', 10)
  if (!dirPath) die('Usage: oam file tree <dirPath> [--depth <n>]')
  const data = (await api(ctx, '/api/file/read-tree', { dirPath, depth })) as TreeNode[]
  if (ctx.json) return printJson(data)
  printTree(data, 0)
}

async function cmdFileRead(ctx: Ctx): Promise<void> {
  const [filePath] = ctx.args
  if (!filePath) die('Usage: oam file read <filePath>')
  const data = (await api(ctx, '/api/file/read', { filePath })) as { content?: string }
  if (ctx.json) return printJson(data)
  console.log(data.content ?? '')
}

// ============================================================
// settings
// ============================================================

async function cmdSettingsGet(ctx: Ctx): Promise<void> {
  const data = await api(ctx, '/api/settings/get')
  printJson(data) // always JSON — settings are structured data
}

async function cmdSettingsSet(ctx: Ctx): Promise<void> {
  const [jsonStr] = ctx.args
  if (!jsonStr) die('Usage: oam settings set <json>\n  Example: oam settings set \'{"general":{"theme":"dark"}}\'')
  let partial: Record<string, unknown>
  try {
    partial = JSON.parse(jsonStr) as Record<string, unknown>
  } catch {
    die('Invalid JSON: ' + jsonStr)
  }
  await api(ctx, '/api/settings/set', partial)
  if (ctx.json) return printJson({ success: true })
  console.log('Settings updated.')
}

// ============================================================
// Help text
// ============================================================

const HELP = `
oam — OpenAgentManager CLI

USAGE
  oam <command> [subcommand] [args] [--json]

GLOBAL OPTIONS
  --json          Output raw JSON instead of formatted text
  --help, -h      Show this help message
  --version       Print version

COMMANDS
  health
    Check if AgentManager is running and show a status summary.

  workspace list
    List all workspaces.

  workspace create <path> [name]
    Create a new workspace from a directory path.

  agent list
    List all installed AI coding agents.

  agent connections
    List all active agent connections.

  agent launch <agentId> <projectPath>
    Launch an installed agent for a project directory.

  agent terminate <connectionId>
    Terminate an active agent connection.

  session list
    List all active sessions.

  session list-persisted
    List all persisted (historical) sessions.

  session get <sessionId>
    Get full session details including all messages (always JSON).

  session create [options]
    Create a new coding session.
      -c, --connection-id <id>    Agent connection ID  (required)
      -w, --workspace-id <id>     Workspace ID         (required)
      -d, --working-dir <path>    Working directory     (default: cwd)
          --worktree              Use git worktree isolation
      -t, --title <title>         Session title
      -m, --mode <mode>           ask | code | plan | act

  session prompt <sessionId> <text...>
    Send a prompt to a session. Blocks until the agent responds.

  session cancel <sessionId>
    Cancel a running prompt in a session.

  session fork <sessionId> [title]
    Fork a session, creating a copy with the same conversation context.

  session remove <sessionId> [--cleanup-worktree]
    Remove a session. Pass --cleanup-worktree to also delete its worktree.

  session permissions
    List all pending permission requests across all sessions.

  session respond <requestId> <optionId>
    Respond to a pending permission request (e.g. allow or deny).

  git status <projectPath>
    Show git status for a repository.

  git diff <workingDir> [filePath]
    Show git diff for a working directory or a specific file.

  file tree <dirPath> [--depth <n>]
    Print the directory tree. Default depth: 3.

  file read <filePath>
    Print the contents of a file.

  settings get
    Print current app settings as JSON.

  settings set <json>
    Update app settings with a partial JSON object.
    Example: oam settings set '{"general":{"theme":"dark"}}'

EXAMPLES
  oam health
  oam workspace list
  oam workspace create /path/to/project "My Project"
  oam agent list
  oam agent launch claude-code /path/to/project
  oam agent connections
  oam session list
  oam session create -c <connId> -w <wsId> -d /path/to/project --title "Fix bugs"
  oam session prompt <sessionId> Fix the TypeScript errors in src/
  oam session permissions
  oam session respond <requestId> allow
  oam session remove <sessionId> --cleanup-worktree
  oam git status /path/to/project
  oam git diff /path/to/project
  oam file tree /path/to/project --depth 2
  oam settings get
  oam settings set '{"general":{"theme":"dark"}}'
`.trim()

// ============================================================
// Main router
// ============================================================

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  const jsonMode = argv.includes('--json')
  const helpFlag = argv.includes('--help') || argv.includes('-h')
  const versionFlag = argv.includes('--version')

  // Strip global flags to get clean command tokens
  const cmdArgs = argv.filter((a) => a !== '--json' && a !== '--help' && a !== '-h' && a !== '--version')

  if (versionFlag) {
    console.log('1.0.0')
    return
  }

  if (helpFlag || cmdArgs.length === 0) {
    console.log(HELP)
    return
  }

  const [cmd, sub, ...rest] = cmdArgs

  if (cmd === 'help') {
    console.log(HELP)
    return
  }

  // All other commands need the running app
  const { port, token } = discover()
  const ctx: Ctx = { port, token, json: jsonMode, args: rest }

  switch (cmd) {
    case 'health':
      return cmdHealth(ctx)

    case 'workspace':
      switch (sub) {
        case 'list':
          return cmdWorkspaceList(ctx)
        case 'create':
          return cmdWorkspaceCreate({ ...ctx, args: rest })
        default:
          die(`Unknown workspace subcommand: "${sub ?? ''}". Try: list, create`)
      }
      break

    case 'agent':
      switch (sub) {
        case 'list':
          return cmdAgentList(ctx)
        case 'connections':
          return cmdAgentConnections(ctx)
        case 'launch':
          return cmdAgentLaunch({ ...ctx, args: rest })
        case 'terminate':
          return cmdAgentTerminate({ ...ctx, args: rest })
        default:
          die(`Unknown agent subcommand: "${sub ?? ''}". Try: list, connections, launch, terminate`)
      }
      break

    case 'session':
      switch (sub) {
        case 'list':
          return cmdSessionList(ctx)
        case 'list-persisted':
          return cmdSessionListPersisted(ctx)
        case 'get':
          return cmdSessionGet({ ...ctx, args: rest })
        case 'create':
          return cmdSessionCreate({ ...ctx, args: rest })
        case 'prompt':
          return cmdSessionPrompt({ ...ctx, args: rest })
        case 'cancel':
          return cmdSessionCancel({ ...ctx, args: rest })
        case 'fork':
          return cmdSessionFork({ ...ctx, args: rest })
        case 'remove':
          return cmdSessionRemove({ ...ctx, args: rest })
        case 'permissions':
          return cmdSessionPermissions(ctx)
        case 'respond':
          return cmdSessionRespond({ ...ctx, args: rest })
        default:
          die(
            `Unknown session subcommand: "${sub ?? ''}". ` +
              'Try: list, list-persisted, get, create, prompt, cancel, fork, remove, permissions, respond'
          )
      }
      break

    case 'git':
      switch (sub) {
        case 'status':
          return cmdGitStatus({ ...ctx, args: rest })
        case 'diff':
          return cmdGitDiff({ ...ctx, args: rest })
        default:
          die(`Unknown git subcommand: "${sub ?? ''}". Try: status, diff`)
      }
      break

    case 'file':
      switch (sub) {
        case 'tree':
          return cmdFileTree({ ...ctx, args: rest })
        case 'read':
          return cmdFileRead({ ...ctx, args: rest })
        default:
          die(`Unknown file subcommand: "${sub ?? ''}". Try: tree, read`)
      }
      break

    case 'settings':
      switch (sub) {
        case 'get':
          return cmdSettingsGet(ctx)
        case 'set':
          return cmdSettingsSet({ ...ctx, args: rest })
        default:
          die(`Unknown settings subcommand: "${sub ?? ''}". Try: get, set`)
      }
      break

    default:
      die(`Unknown command: "${cmd}"\nRun 'oam --help' for usage.`)
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
