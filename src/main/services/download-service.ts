import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { BinaryTarget } from '@shared/types/agent'
import { getDownloadsDir, getAgentInstallDir } from '../util/paths'
import { logger } from '../util/logger'

const execFileAsync = promisify(execFile)

export class DownloadService {
  /**
   * Download and extract a binary agent
   */
  async downloadAndExtract(
    agentId: string,
    version: string,
    target: BinaryTarget
  ): Promise<string> {
    const downloadDir = getDownloadsDir()
    const installDir = getAgentInstallDir(agentId, version)

    // Determine archive filename from URL
    const archiveUrl = target.archive
    const archiveName = path.basename(new URL(archiveUrl).pathname)
    const archivePath = path.join(downloadDir, archiveName)

    logger.info(`Downloading agent binary: ${archiveUrl}`)

    // Download the archive
    const response = await fetch(archiveUrl)
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    // Stream to disk
    const readableNodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream)
    await pipeline(readableNodeStream, createWriteStream(archivePath))

    logger.info(`Downloaded to ${archivePath}, extracting to ${installDir}`)

    // Extract based on file extension
    await this.extract(archivePath, installDir)

    // Verify the command exists
    const cmdPath = path.join(installDir, target.cmd)
    if (!fs.existsSync(cmdPath)) {
      // Try searching in subdirectories (some archives nest files)
      const found = this.findExecutable(installDir, target.cmd)
      if (!found) {
        throw new Error(`Executable not found after extraction: ${target.cmd}`)
      }
      return found
    }

    // Make executable on unix
    if (process.platform !== 'win32') {
      fs.chmodSync(cmdPath, 0o755)
    }

    // Clean up archive
    try {
      fs.unlinkSync(archivePath)
    } catch { /* ignore */ }

    return cmdPath
  }

  private async extract(archivePath: string, destDir: string): Promise<void> {
    const ext = archivePath.toLowerCase()

    // Use execFileAsync (no shell) to prevent injection via path metacharacters
    if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
      await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir])
    } else if (ext.endsWith('.tar.xz')) {
      await execFileAsync('tar', ['-xJf', archivePath, '-C', destDir])
    } else if (ext.endsWith('.zip')) {
      if (process.platform === 'win32') {
        await execFileAsync('powershell', [
          '-NoProfile', '-NonInteractive', '-command',
          'Expand-Archive',
          '-Path', archivePath,
          '-DestinationPath', destDir,
          '-Force'
        ])
      } else {
        await execFileAsync('unzip', ['-o', archivePath, '-d', destDir])
      }
    } else {
      throw new Error(`Unsupported archive format: ${path.extname(archivePath)}`)
    }
  }

  private findExecutable(dir: string, cmd: string): string | null {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name === cmd) {
        return path.join(entry.parentPath || dir, entry.name)
      }
      // On Windows, also check with .exe
      if (process.platform === 'win32' && entry.isFile() && entry.name === `${cmd}.exe`) {
        return path.join(entry.parentPath || dir, entry.name)
      }
    }
    return null
  }
}

export const downloadService = new DownloadService()
