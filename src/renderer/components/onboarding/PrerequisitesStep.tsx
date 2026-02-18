import React, { useEffect, useState } from 'react'
import { Badge } from '../common/Badge'
import { Spinner } from '../common/Spinner'
import { Button } from '../common/Button'

interface Prerequisite {
  id: string
  name: string
  commands: string[]
  description: string
  required: boolean
  installHint: string
}

const PREREQUISITES: Prerequisite[] = [
  {
    id: 'node',
    name: 'Node.js',
    commands: ['node'],
    description: 'JavaScript runtime required for npx-based agents (Claude Code, Codex, etc.)',
    required: true,
    installHint: 'Download from https://nodejs.org or install via your package manager'
  },
  {
    id: 'npm',
    name: 'npm / npx',
    commands: ['npx'],
    description: 'Package runner used to launch npx-distributed agents',
    required: true,
    installHint: 'Included with Node.js — install Node.js to get npm and npx'
  },
  {
    id: 'git',
    name: 'Git',
    commands: ['git'],
    description: 'Version control system used for worktrees and session isolation',
    required: true,
    installHint: 'Download from https://git-scm.com or install via your package manager'
  },
  {
    id: 'uv',
    name: 'uv / uvx',
    commands: ['uvx'],
    description: 'Python package runner used to launch uvx-distributed agents',
    required: false,
    installHint: 'Install from https://docs.astral.sh/uv/getting-started/installation/'
  }
]

type CheckStatus = 'checking' | 'found' | 'missing'

export function PrerequisitesStep() {
  const [status, setStatus] = useState<Record<string, CheckStatus>>({})
  const [checking, setChecking] = useState(true)

  const runChecks = async () => {
    setChecking(true)
    const allCommands = PREREQUISITES.flatMap((p) => p.commands)

    // Mark everything as checking
    const initial: Record<string, CheckStatus> = {}
    for (const p of PREREQUISITES) {
      initial[p.id] = 'checking'
    }
    setStatus(initial)

    try {
      const results = await window.api.invoke('agent:detect-cli', { commands: allCommands })

      const nextStatus: Record<string, CheckStatus> = {}
      for (const prereq of PREREQUISITES) {
        const found = prereq.commands.some((cmd) => results[cmd])
        nextStatus[prereq.id] = found ? 'found' : 'missing'
      }
      setStatus(nextStatus)
    } catch {
      // If detection fails entirely, mark all as missing
      const fallback: Record<string, CheckStatus> = {}
      for (const p of PREREQUISITES) {
        fallback[p.id] = 'missing'
      }
      setStatus(fallback)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    runChecks()
  }, [])

  const requiredMissing = PREREQUISITES.filter((p) => p.required && status[p.id] === 'missing')
  const allChecked = !checking && Object.values(status).every((s) => s !== 'checking')

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-text-primary mb-2">System Prerequisites</h2>
      <p className="text-sm text-text-secondary mb-6">
        Checking your system for the tools needed to run AI coding agents.
      </p>

      <div className="space-y-3">
        {PREREQUISITES.map((prereq) => {
          const s = status[prereq.id] ?? 'checking'
          return (
            <div
              key={prereq.id}
              className="border border-border rounded-lg p-4 bg-surface-2"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {s === 'checking' && <Spinner size="sm" />}
                  {s === 'found' && (
                    <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
                      <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  {s === 'missing' && (
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${prereq.required ? 'bg-error/20' : 'bg-warning/20'}`}>
                      <svg className={`w-3 h-3 ${prereq.required ? 'text-error' : 'text-warning'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-sm font-semibold text-text-primary">{prereq.name}</h3>
                    {prereq.required ? (
                      <Badge variant="default">Required</Badge>
                    ) : (
                      <Badge variant="default">Optional</Badge>
                    )}
                    {s === 'found' && <Badge variant="success">Found</Badge>}
                    {s === 'missing' && prereq.required && <Badge variant="error">Not found</Badge>}
                    {s === 'missing' && !prereq.required && <Badge variant="warning">Not found</Badge>}
                  </div>
                  <p className="text-xs text-text-secondary">{prereq.description}</p>
                  {s === 'missing' && (
                    <p className="text-xs text-text-muted mt-1.5">{prereq.installHint}</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {allChecked && requiredMissing.length > 0 && (
        <div className="mt-6 p-4 border border-warning/30 rounded-lg bg-warning/5">
          <p className="text-sm text-warning font-medium mb-1">
            Missing required prerequisites
          </p>
          <p className="text-xs text-text-secondary">
            Install the required tools listed above, then re-check. You can still continue, but
            some agents may not work without them.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={runChecks} loading={checking}>
            Re-check
          </Button>
        </div>
      )}

      {allChecked && requiredMissing.length === 0 && (
        <div className="mt-6 p-4 border border-success/30 rounded-lg bg-success/5">
          <p className="text-sm text-success font-medium">
            All required prerequisites are installed
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            Your system is ready to run AI coding agents.
          </p>
        </div>
      )}
    </div>
  )
}
