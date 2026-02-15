import React, { useState } from 'react'
import type { AuthMethod } from '@shared/types/agent'
import { useAgentStore } from '../../stores/agent-store'
import { Button } from '../common/Button'

interface AuthMethodPromptProps {
  authMethods: AuthMethod[]
  /** Agent connection ID — needed to terminate + relaunch with env vars. */
  connectionId: string
  agentId: string
  projectPath: string
}

/**
 * Renders actionable auth method cards based on the ACP auth method type.
 *
 * - `agent` / untyped: Show description text (user handles auth externally).
 * - `env_var`: Show input for the env variable value + restart button.
 * - `terminal`: Show description (terminal integration is future work).
 */
export function AuthMethodPrompt({
  authMethods,
  connectionId,
  agentId,
  projectPath
}: AuthMethodPromptProps) {
  if (!authMethods.length) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-text-secondary">Authentication required</p>
      {authMethods.map((method) => (
        <AuthMethodCard
          key={method.id}
          method={method}
          connectionId={connectionId}
          agentId={agentId}
          projectPath={projectPath}
        />
      ))}
    </div>
  )
}

function AuthMethodCard({
  method,
  connectionId,
  agentId,
  projectPath
}: {
  method: AuthMethod
  connectionId: string
  agentId: string
  projectPath: string
}) {
  const type = method.type || 'agent'

  if (type === 'env_var' && method.varName) {
    return (
      <EnvVarAuthCard
        method={method}
        connectionId={connectionId}
        agentId={agentId}
        projectPath={projectPath}
      />
    )
  }

  // agent / terminal / fallback: show description
  return (
    <div className="text-xs text-text-muted">
      <span className="font-medium text-text-secondary">{method.name}</span>
      {method.description && <span className="ml-1">&mdash; {method.description}</span>}
    </div>
  )
}

function EnvVarAuthCard({
  method,
  connectionId,
  agentId,
  projectPath
}: {
  method: AuthMethod
  connectionId: string
  agentId: string
  projectPath: string
}) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { terminateAgent, launchAgent } = useAgentStore()

  const handleSubmit = async () => {
    if (!value.trim() || !method.varName) return
    setLoading(true)
    setError(null)
    try {
      // Terminate current connection, relaunch with the env var set
      await terminateAgent(connectionId)
      await launchAgent(agentId, projectPath, { [method.varName]: value.trim() })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-surface-1 rounded-lg px-3 py-2 border border-border">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-text-secondary">{method.name}</span>
        {method.link && (
          <a
            href={method.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-accent hover:text-accent-hover underline"
          >
            Get key
          </a>
        )}
      </div>
      {method.description && (
        <p className="text-[10px] text-text-muted mb-1.5">{method.description}</p>
      )}
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={method.varName}
          className="flex-1 bg-surface-0 border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
          }}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={!value.trim() || loading}
          loading={loading}
          onClick={handleSubmit}
        >
          Set &amp; restart
        </Button>
      </div>
      {error && <p className="text-[10px] text-error mt-1">{error}</p>}
    </div>
  )
}
