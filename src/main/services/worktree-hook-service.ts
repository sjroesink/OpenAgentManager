import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import type { AgentProjectConfig, WorktreeHooksConfig } from '@shared/types/thread-format'
import { AGENT_DIR_NAME } from '@shared/types/thread-format'
import type { WorktreeHookProgressEvent, HookStep } from '@shared/types/session'
import { logger } from '../util/logger'

const CONFIG_FILE = 'config.json'

export class WorktreeHookService {
  readConfig(workspacePath: string): AgentProjectConfig | null {
    const configPath = path.join(workspacePath, AGENT_DIR_NAME, CONFIG_FILE)
    try {
      if (!fs.existsSync(configPath)) return null
      const raw = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(raw) as AgentProjectConfig
    } catch (error) {
      logger.warn('Failed to read .agent/config.json:', error)
      return null
    }
  }

  writeConfig(workspacePath: string, config: AgentProjectConfig): void {
    const agentDir = path.join(workspacePath, AGENT_DIR_NAME)
    fs.mkdirSync(agentDir, { recursive: true })
    const configPath = path.join(agentDir, CONFIG_FILE)
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  }

  async executeHooks(
    originalRepoPath: string,
    worktreePath: string,
    sessionId: string,
    progressCb?: (event: WorktreeHookProgressEvent) => void
  ): Promise<string | undefined> {
    const config = this.readConfig(originalRepoPath)
    if (!config?.worktreeHooks) return undefined

    const hooks = config.worktreeHooks

    // Build the full step list upfront
    const steps: HookStep[] = []

    if (hooks.symlinks && hooks.symlinks.length > 0) {
      for (const entry of hooks.symlinks) {
        steps.push({ label: `Symlink ${entry.source}`, status: 'pending' })
      }
    }

    if (hooks.postSetupCommands && hooks.postSetupCommands.length > 0) {
      for (const cmd of hooks.postSetupCommands) {
        // Skip platform-filtered commands
        if (cmd.platforms && !cmd.platforms.includes(process.platform as 'win32' | 'darwin' | 'linux')) {
          continue
        }
        steps.push({ label: cmd.label || cmd.command, status: 'pending' })
      }
    }

    if (hooks.initialPrompt) {
      steps.push({ label: 'Initial prompt', status: 'pending' })
    }

    if (steps.length === 0) return hooks.initialPrompt

    const emit = (): void => {
      progressCb?.({ sessionId, steps: [...steps.map((s) => ({ ...s }))] })
    }

    emit()

    let stepIndex = 0

    // Phase 1: Symlinks
    if (hooks.symlinks && hooks.symlinks.length > 0) {
      for (const entry of hooks.symlinks) {
        steps[stepIndex].status = 'running'
        emit()

        try {
          this.createSymlink(entry.source, entry.target, originalRepoPath, worktreePath)
          steps[stepIndex].status = 'completed'
        } catch (error) {
          steps[stepIndex].status = 'failed'
          steps[stepIndex].detail = String(error)
          logger.warn(`Failed to create symlink ${entry.source}:`, error)
        }

        emit()
        stepIndex++
      }
    }

    // Phase 2: Commands
    if (hooks.postSetupCommands && hooks.postSetupCommands.length > 0) {
      for (const cmd of hooks.postSetupCommands) {
        if (cmd.platforms && !cmd.platforms.includes(process.platform as 'win32' | 'darwin' | 'linux')) {
          continue
        }

        const timeout = cmd.timeout ?? 120_000

        steps[stepIndex].status = 'running'
        emit()

        try {
          await this.execCommand(cmd.command, worktreePath, timeout)
          steps[stepIndex].status = 'completed'
          logger.info(`Post-setup command completed: ${cmd.command}`)
        } catch (error) {
          steps[stepIndex].status = 'failed'
          steps[stepIndex].detail = String(error)
          logger.warn(`Post-setup command failed: ${cmd.command}`, error)

          if (!cmd.continueOnError) {
            emit()
            // Mark remaining command steps as pending (skip them)
            return hooks.initialPrompt
          }
        }

        emit()
        stepIndex++
      }
    }

    // Phase 3: Initial prompt (just mark it as running — the actual send happens in session-manager)
    if (hooks.initialPrompt) {
      steps[stepIndex].status = 'running'
      emit()
    }

    return hooks.initialPrompt
  }

  private createSymlink(
    source: string,
    target: string | undefined,
    originalRepoPath: string,
    worktreePath: string
  ): void {
    const sourcePath = path.resolve(originalRepoPath, source)
    const targetRelative = target || source
    const targetPath = path.resolve(worktreePath, targetRelative)

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source does not exist: ${source}`)
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })

    // Remove existing file/dir at target (worktree may have a copy)
    try {
      const lstat = fs.lstatSync(targetPath)
      if (lstat) {
        fs.rmSync(targetPath, { recursive: true, force: true })
      }
    } catch {
      // Target doesn't exist — that's fine
    }

    const stat = fs.statSync(sourcePath)

    if (process.platform === 'win32' && stat.isDirectory()) {
      // Junction for directories on Windows — no admin needed
      fs.symlinkSync(sourcePath, targetPath, 'junction')
    } else {
      fs.symlinkSync(sourcePath, targetPath)
    }

    logger.info(`Symlink created: ${targetPath} -> ${sourcePath}`)
  }

  private execCommand(command: string, cwd: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const child = spawn(command, {
        cwd,
        shell: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stderr = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        fn()
      }

      // Use 'close' instead of 'exit' — 'close' fires after all stdio streams are done,
      // which avoids premature null exit codes on Windows.
      child.on('close', (code, signal) => {
        settle(() => {
          if (code === 0) {
            resolve()
          } else if (code !== null) {
            reject(new Error(`Exited with code ${code}: ${stderr.slice(0, 500)}`))
          } else if (signal) {
            reject(new Error(`Killed by signal ${signal}${timeout ? ' (timeout)' : ''}`))
          } else {
            // code null, no signal — treat as success
            resolve()
          }
        })
      })

      child.on('error', (err) => {
        settle(() => reject(new Error(`Failed to start: ${err.message}`)))
      })

      // Manual timeout — more reliable than spawn's timeout option on Windows
      if (timeout > 0) {
        timer = setTimeout(() => {
          settle(() => {
            child.kill()
            reject(new Error(`Timed out after ${Math.round(timeout / 1000)}s`))
          })
        }, timeout)
      }
    })
  }
}

export const worktreeHookService = new WorktreeHookService()
