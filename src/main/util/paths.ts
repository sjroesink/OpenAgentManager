import { app } from 'electron'
import path from 'path'
import fs from 'fs'

/** Base directory for all AgentManager data */
export function getAppDataDir(): string {
  const dir = path.join(app.getPath('userData'))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Directory where binary agents are installed */
export function getAgentsDir(): string {
  const dir = path.join(getAppDataDir(), 'agents')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Directory for a specific installed binary agent */
export function getAgentInstallDir(agentId: string, version: string): string {
  const dir = path.join(getAgentsDir(), agentId, version)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Directory for cached registry data */
export function getCacheDir(): string {
  const dir = path.join(getAppDataDir(), 'cache')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Path to the cached registry JSON */
export function getRegistryCachePath(): string {
  return path.join(getCacheDir(), 'registry.json')
}

/** Path for session persistence */
export function getSessionsDir(): string {
  const dir = path.join(getAppDataDir(), 'sessions')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Directory for git worktrees */
export function getWorktreesDir(): string {
  const dir = path.join(getAppDataDir(), 'worktrees')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Temp directory for downloads */
export function getDownloadsDir(): string {
  const dir = path.join(getAppDataDir(), 'downloads')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
