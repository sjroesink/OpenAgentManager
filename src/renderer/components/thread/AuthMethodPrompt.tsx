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
  onAuthFlowComplete?: () => Promise<void> | void
}

/**
 * Renders actionable auth method cards based on the ACP auth method type.
 *
 * - `agent` / untyped: Show description + "Authenticate" button (authenticate call).
 * - `env_var`: Show input for the env variable value + restart button.
 * - `terminal`: Show description + "Log in" button (authenticate call).
 */
export function AuthMethodPrompt({
  authMethods,
  connectionId,
  agentId,
  projectPath,
  onAuthFlowComplete
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
          onAuthFlowComplete={onAuthFlowComplete}
        />
      ))}
    </div>
  )
}

function AuthMethodCard({
  method,
  connectionId,
  agentId,
  projectPath,
  onAuthFlowComplete
}: {
  method: AuthMethod
  connectionId: string
  agentId: string
  projectPath: string
  onAuthFlowComplete?: () => Promise<void> | void
}) {
  const type = method.type || 'agent'

  if (type === 'env_var' && method.varName) {
    return (
      <EnvVarAuthCard
        method={method}
        connectionId={connectionId}
        agentId={agentId}
        projectPath={projectPath}
        onAuthFlowComplete={onAuthFlowComplete}
      />
    )
  }

  if (type === 'terminal') {
    return (
      <RelaunchAuthCard
        method={method}
        connectionId={connectionId}
        agentId={agentId}
        projectPath={projectPath}
        buttonLabel="Log in"
        onAuthFlowComplete={onAuthFlowComplete}
      />
    )
  }

  // agent type (default): agent handles auth itself (e.g. OAuth)
  return (
    <RelaunchAuthCard
      method={method}
      connectionId={connectionId}
      agentId={agentId}
      projectPath={projectPath}
      buttonLabel="Authenticate"
      onAuthFlowComplete={onAuthFlowComplete}
    />
  )
}

/**
 * Auth card for `agent` and `terminal` types.
 * Triggers ACP authenticate with the selected auth method.
 * Falls back to terminate+relaunch when authenticate is not supported.
 */
function RelaunchAuthCard({
  method,
  connectionId,
  agentId,
  projectPath,
  buttonLabel,
  onAuthFlowComplete
}: {
  method: AuthMethod
  connectionId: string
  agentId: string
  projectPath: string
  buttonLabel: string
  onAuthFlowComplete?: () => Promise<void> | void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { authenticateAgent, terminateAgent, launchAgent } = useAgentStore()

  const shouldFallbackToRelaunch = (value: unknown): boolean => {
    if (!(value instanceof Error)) return false
    // Fall back to terminate+relaunch when authenticate is not supported
    // OR when the error is auth-related (e.g. expired OAuth token) —
    // the agent needs a fresh process to re-trigger its auth flow.
    return (
      /ACP error -32601/i.test(value.message) ||
      /Method not found/i.test(value.message) ||
      /Method not implemented/i.test(value.message) ||
      /auth|unauthorized|token|forbidden|401|403|expired/i.test(value.message)
    )
  }

  const handleReauth = async () => {
    setLoading(true)
    setError(null)
    try {
      try {
        await authenticateAgent(connectionId, method.id)
      } catch (authError) {
        if (!shouldFallbackToRelaunch(authError)) {
          throw authError
        }
        // Relaunch the agent so it can re-trigger its auth flow (e.g. OAuth).
        await terminateAgent(connectionId)
        await launchAgent(agentId, projectPath)
      }
      await onAuthFlowComplete?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-surface-1 rounded-lg px-3 py-2 border border-border">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-medium text-text-secondary">{method.name}</span>
          {method.description && (
            <p className="text-[10px] text-text-muted mt-0.5">{method.description}</p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={loading}
          onClick={handleReauth}
        >
          {buttonLabel}
        </Button>
      </div>
      {error && <p className="text-[10px] text-error mt-1">{error}</p>}
    </div>
  )
}

function EnvVarAuthCard({
  method,
  connectionId,
  agentId,
  projectPath,
  onAuthFlowComplete
}: {
  method: AuthMethod
  connectionId: string
  agentId: string
  projectPath: string
  onAuthFlowComplete?: () => Promise<void> | void
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
      const currentSettings = await window.api.invoke('settings:get', undefined)
      const existingApiKeys = currentSettings.agents[agentId]?.apiKeys ?? {}
      await window.api.invoke('settings:set-agent', {
        agentId,
        settings: {
          apiKeys: {
            ...existingApiKeys,
            [method.varName]: value.trim()
          }
        }
      })

      // Persist the key, then relaunch so auto-auth can apply the env_var method.
      await terminateAgent(connectionId)
      await launchAgent(agentId, projectPath)
      await onAuthFlowComplete?.()
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

