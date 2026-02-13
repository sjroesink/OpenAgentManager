import fs from 'fs'
import path from 'path'
import type { FileTreeNode, FileChange } from '@shared/types/project'
import { logger } from '../util/logger'

/** Directories and files to skip when building file tree */
const IGNORED_ENTRIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '__pycache__',
  '.venv',
  'dist',
  'build',
  '.cache',
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.local'
])

export class FileService {
  /**
   * Build a file tree for a directory
   */
  readTree(dirPath: string, depth = 3): FileTreeNode[] {
    try {
      return this.buildTree(dirPath, depth, 0)
    } catch (error) {
      logger.error(`Failed to read tree: ${dirPath}`, error)
      return []
    }
  }

  /**
   * Read file contents
   */
  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8')
  }

  /**
   * Get list of changed files (tracked by git) in a directory
   */
  async getChanges(workingDir: string): Promise<FileChange[]> {
    // This is handled by git-service.getDiff, but we can also
    // provide a simple file-based change detection
    const simpleGit = (await import('simple-git')).default
    const git = simpleGit(workingDir)

    try {
      const status = await git.status()
      const changes: FileChange[] = []

      for (const file of status.created) {
        changes.push({ path: file, status: 'added', additions: 0, deletions: 0 })
      }
      for (const file of status.modified) {
        changes.push({ path: file, status: 'modified', additions: 0, deletions: 0 })
      }
      for (const file of status.deleted) {
        changes.push({ path: file, status: 'deleted', additions: 0, deletions: 0 })
      }
      for (const file of status.renamed) {
        changes.push({
          path: file.to,
          status: 'renamed',
          oldPath: file.from,
          additions: 0,
          deletions: 0
        })
      }

      return changes
    } catch {
      return []
    }
  }

  private buildTree(dirPath: string, maxDepth: number, currentDepth: number): FileTreeNode[] {
    if (currentDepth >= maxDepth) return []

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const nodes: FileTreeNode[] = []

    // Sort: directories first, then files, alphabetically
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of sorted) {
      if (IGNORED_ENTRIES.has(entry.name)) continue

      const fullPath = path.join(dirPath, entry.name)
      const node: FileTreeNode = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file'
      }

      if (entry.isDirectory()) {
        node.children = this.buildTree(fullPath, maxDepth, currentDepth + 1)
      } else {
        node.extension = path.extname(entry.name).slice(1)
        try {
          node.size = fs.statSync(fullPath).size
        } catch { /* ignore */ }
      }

      nodes.push(node)
    }

    return nodes
  }
}

export const fileService = new FileService()
