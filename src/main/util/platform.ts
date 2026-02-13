import type { PlatformTarget } from '@shared/types/agent'

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
