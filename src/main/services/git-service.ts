import simpleGit, { type SimpleGit } from 'simple-git'
import path from 'path'
import fs from 'fs'
import type { GitStatus, WorktreeInfo, CommitResult } from '@shared/types/git'
import type { DiffResult, FileDiff } from '@shared/types/project'
import { DEFAULT_WORKTREE_PREFIX } from '@shared/constants'
import { settingsService } from './settings-service'
import { getWorktreesDir } from '../util/paths'
import { logger } from '../util/logger'

export class GitService {
  /**
   * Create a worktree for a session
   */
  async createWorktree(
    projectPath: string,
    sessionId: string,
    baseBranch?: string
  ): Promise<WorktreeInfo> {
    const git = simpleGit(projectPath)

    // Verify this is a git repo
    const isRepo = await git.checkIsRepo()
    if (!isRepo) {
      throw new Error(`Not a git repository: ${projectPath}`)
    }

    const branchName = `${DEFAULT_WORKTREE_PREFIX}${sessionId}`
    const worktreeBase = this.getWorktreeBase(projectPath)
    const worktreePath = path.join(worktreeBase, `thread-${sessionId}`)

    // Ensure base directory exists
    fs.mkdirSync(worktreeBase, { recursive: true })

    // Create worktree with new branch
    const base = baseBranch || 'HEAD'
    await git.raw(['worktree', 'add', '-b', branchName, worktreePath, base])

    const head = await this.getHead(worktreePath)

    logger.info(`Worktree created: ${worktreePath} on branch ${branchName}`)

    return {
      path: worktreePath,
      branch: branchName,
      head,
      isMain: false,
      sessionId,
      createdAt: new Date().toISOString()
    }
  }

  /**
   * Remove a worktree (with retry for Windows EBUSY)
   */
  async removeWorktree(projectPath: string, worktreePath: string): Promise<void> {
    const git = simpleGit(projectPath)
    try {
      await git.raw(['worktree', 'remove', worktreePath, '--force'])
      logger.info(`Worktree removed: ${worktreePath}`)
    } catch (error) {
      logger.warn(`Failed to remove worktree via git, trying manual cleanup:`, error)
      // Fallback: remove directory and prune, with retries for EBUSY on Windows
      if (fs.existsSync(worktreePath)) {
        await this.rmWithRetry(worktreePath)
      }
      await git.raw(['worktree', 'prune'])
    }
  }

  /**
   * Remove a directory with retries to handle EBUSY on Windows.
   * Processes may take a moment to release file handles after termination.
   */
  private async rmWithRetry(dirPath: string, maxRetries = 3, delayMs = 1000): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true })
        return
      } catch (error: unknown) {
        const isRetryable = error instanceof Error &&
          'code' in error &&
          ((error as NodeJS.ErrnoException).code === 'EBUSY' || (error as NodeJS.ErrnoException).code === 'EPERM')
        if (isRetryable && attempt < maxRetries) {
          logger.info(`Retry ${attempt}/${maxRetries} removing ${dirPath} after ${delayMs}ms...`)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        } else {
          throw error
        }
      }
    }
  }

  /**
   * List all worktrees for a project
   */
  async listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
    const git = simpleGit(projectPath)
    const result = await git.raw(['worktree', 'list', '--porcelain'])
    return this.parseWorktreeList(result)
  }

  /**
   * Get git status for a working directory
   */
  async getStatus(workingDir: string): Promise<GitStatus> {
    const git = simpleGit(workingDir)
    const status = await git.status()

    return {
      branch: status.current || '',
      isClean: status.isClean(),
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
      ahead: status.ahead,
      behind: status.behind
    }
  }

  /**
   * Get diff for a working directory
   */
  async getDiff(workingDir: string, filePath?: string): Promise<DiffResult> {
    const git = simpleGit(workingDir)

    // Get diff of all changes (staged + unstaged)
    const diffArgs = ['HEAD']
    if (filePath) diffArgs.push('--', filePath)

    let diffText: string
    try {
      diffText = await git.diff(diffArgs)
    } catch {
      // If HEAD doesn't exist (fresh repo), diff against empty
      diffText = await git.diff(['--cached', ...(filePath ? ['--', filePath] : [])])
    }

    return this.parseDiff(diffText, workingDir)
  }

  /**
   * Stage files and commit
   */
  async commit(
    workingDir: string,
    message: string,
    files: string[]
  ): Promise<CommitResult> {
    const git = simpleGit(workingDir)

    await git.add(files)
    const result = await git.commit(message)
    const status = await git.status()

    return {
      hash: result.commit,
      message,
      branch: status.current || ''
    }
  }

  /**
   * Check if a path is a git repository
   */
  async isGitRepo(dirPath: string): Promise<boolean> {
    try {
      const git = simpleGit(dirPath)
      return await git.checkIsRepo()
    } catch {
      return false
    }
  }

  /**
   * Get current branch name
   */
  async getBranch(dirPath: string): Promise<string | undefined> {
    try {
      const git = simpleGit(dirPath)
      const status = await git.status()
      return status.current || undefined
    } catch {
      return undefined
    }
  }

  // ============================
  // Private helpers
  // ============================

  private getWorktreeBase(projectPath: string): string {
    const settings = settingsService.get()
    if (settings.git.worktreeBaseDir) {
      return settings.git.worktreeBaseDir
    }
    return path.join(getWorktreesDir(), path.basename(projectPath))
  }

  private async getHead(workingDir: string): Promise<string> {
    try {
      const git = simpleGit(workingDir)
      const log = await git.log({ maxCount: 1 })
      return log.latest?.hash || ''
    } catch {
      return ''
    }
  }

  private parseWorktreeList(porcelain: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = []
    const blocks = porcelain.trim().split('\n\n')

    for (const block of blocks) {
      if (!block.trim()) continue

      const lines = block.split('\n')
      let wtPath = ''
      let head = ''
      let branch = ''
      let isMain = false

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.slice(9)
        } else if (line.startsWith('HEAD ')) {
          head = line.slice(5)
        } else if (line.startsWith('branch ')) {
          branch = line.slice(7).replace('refs/heads/', '')
        }
      }

      // First worktree is the main one
      if (worktrees.length === 0) isMain = true

      if (wtPath) {
        worktrees.push({
          path: wtPath,
          branch,
          head,
          isMain,
          createdAt: ''
        })
      }
    }

    return worktrees
  }

  private async parseDiff(diffText: string, workingDir: string): Promise<DiffResult> {
    const files: FileDiff[] = []

    if (!diffText.trim()) {
      return { files }
    }

    // Simple diff parsing - split by file boundaries
    const fileSections = diffText.split(/^diff --git /m).filter(Boolean)

    for (const section of fileSections) {
      const lines = section.split('\n')
      const headerMatch = lines[0]?.match(/a\/(.*?) b\/(.*)/)
      if (!headerMatch) continue

      const filePath = headerMatch[2]

      // Try to read current and original content for the diff viewer
      let oldContent = ''
      let newContent = ''

      try {
        const fullPath = path.join(workingDir, filePath)
        if (fs.existsSync(fullPath)) {
          newContent = fs.readFileSync(fullPath, 'utf-8')
        }

        // Get the original content from git
        const git = simpleGit(workingDir)
        try {
          oldContent = await git.show([`HEAD:${filePath}`])
        } catch {
          oldContent = '' // New file
        }
      } catch {
        // Ignore read errors
      }

      files.push({
        path: filePath,
        oldContent,
        newContent
      })
    }

    return { files }
  }
}

export const gitService = new GitService()
