import type { PlatformTarget } from '@shared/types/agent'
import { execSync } from 'child_process'
import { logger } from './logger'

/**
 * Get the current platform target string for binary agent downloads
 */
export function getCurrentPlatformTarget(): PlatformTarget | null {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'darwin' && arch === 'arm64') return 'darwin-aarch64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x86_64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-aarch64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x86_64'
  if (platform === 'win32' && arch === 'arm64') return 'windows-aarch64'
  if (platform === 'win32' && arch === 'x64') return 'windows-x86_64'

  return null
}

/** Check if npx is available */
export function getNpxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

/** Check if uvx is available */
export function getUvxCommand(): string {
  return process.platform === 'win32' ? 'uvx.cmd' : 'uvx'
}

// ============================================================
// WSL Helpers (Windows only)
// ============================================================

/** Check if WSL is available on this system */
export function isWslAvailable(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execSync('wsl --status', { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    // --status may return non-zero on older builds, try listing distros instead
    try {
      const output = execSync('wsl -l -q', { stdio: 'pipe', timeout: 5000 })
      return output.toString().trim().length > 0
    } catch {
      return false
    }
  }
}

/** Get list of installed WSL distributions */
export function getWslDistributions(): string[] {
  if (process.platform !== 'win32') return []
  try {
    // wsl -l -q outputs UTF-16LE on Windows — decode properly
    const output = execSync('wsl -l -q', { stdio: 'pipe', timeout: 5000 })
    const text = output.toString('utf16le')
    return text
      .split('\n')
      .map((line) => line.replace(/\0/g, '').trim())
      .filter((line) => line.length > 0)
  } catch (err) {
    logger.warn('Failed to list WSL distributions:', err)
    return []
  }
}

/** Convert a Windows path to WSL mount path (e.g. D:\Projects\Foo → /mnt/d/Projects/Foo) */
export function toWslPath(windowsPath: string): string {
  // Handle UNC paths or already-Linux paths
  if (windowsPath.startsWith('/')) return windowsPath

  // D:\foo\bar → /mnt/d/foo/bar
  const normalized = windowsPath.replace(/\\/g, '/')
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (match) {
    const drive = match[1].toLowerCase()
    const rest = match[2]
    return `/mnt/${drive}/${rest}`
  }

  return windowsPath
}
