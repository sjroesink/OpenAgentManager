import React, { useCallback, useEffect, useState } from 'react'
import { useAgentStore } from '../../stores/agent-store'
import { AgentIcon } from '../common/AgentIcon'
import { Badge } from '../common/Badge'
import { Button } from '../common/Button'
import { Spinner } from '../common/Spinner'
import { AuthMethodPrompt } from '../thread/AuthMethodPrompt'

export function AgentAuthenticationStep() {
  const { installed, authChecks, authCheckErrors, checkAgentAuth } = useAgentStore()
  const [checkingIds, setCheckingIds] = useState<Record<string, boolean>>({})

  const checkSingleAgent = useCallback(
    async (agentId: string) => {
      setCheckingIds((state) => ({ ...state, [agentId]: true }))
      try {
        await checkAgentAuth(agentId)
      } finally {
        setCheckingIds((state) => ({ ...state, [agentId]: false }))
      }
    },
    [checkAgentAuth]
  )

  useEffect(() => {
    const uncheckedAgents = installed.filter((agent) => {
      const id = agent.registryId
      return !authChecks[id] && !authCheckErrors[id]
    })
    if (uncheckedAgents.length === 0) return

    Promise.all(uncheckedAgents.map((agent) => checkSingleAgent(agent.registryId))).catch(() => {
      // Errors are reflected per-agent in the check result; no global action needed.
    })
  }, [installed, authChecks, authCheckErrors, checkSingleAgent])

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-text-primary mb-2">Authenticate Agents</h2>
      <p className="text-sm text-text-secondary mb-6">
        We started your installed agents and checked whether authentication is already complete.
      </p>

      {installed.length === 0 && (
        <div className="text-sm text-text-muted text-center py-8">
          No installed agents yet.
        </div>
      )}

      {installed.length > 0 && (
        <div className="space-y-4">
          {installed.map((agent) => {
            const check = authChecks[agent.registryId]
            const checkError = check?.error || authCheckErrors[agent.registryId]
            const isChecking = checkingIds[agent.registryId] ?? false
            const isAuthenticated = check?.isAuthenticated ?? false
            const requiresAuthentication = check?.requiresAuthentication ?? false

            return (
              <div key={agent.registryId} className="border border-border rounded-lg p-4 bg-surface-2">
                <div className="flex items-start gap-3">
                  <AgentIcon
                    agentId={agent.registryId}
                    icon={agent.icon}
                    name={agent.name}
                    size="lg"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-sm font-semibold text-text-primary truncate">{agent.name}</h3>
                      <Badge variant="default">{agent.version}</Badge>

                      {isChecking && (
                        <Badge variant="default">
                          <span className="inline-flex items-center gap-1">
                            <Spinner size="sm" />
                            Checking
                          </span>
                        </Badge>
                      )}

                      {!isChecking && isAuthenticated && (
                        <Badge variant="success">
                          <span className="inline-flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            Authenticated
                          </span>
                        </Badge>
                      )}

                      {!isChecking && !isAuthenticated && requiresAuthentication && (
                        <Badge variant="warning">Authentication required</Badge>
                      )}

                      {!isChecking && !isAuthenticated && checkError && !requiresAuthentication && (
                        <Badge variant="error">Check failed</Badge>
                      )}
                    </div>

                    <p className="text-xs text-text-secondary mb-3">{agent.description}</p>

                    {!isChecking && isAuthenticated && (
                      <p className="text-xs text-success">This agent is ready to use.</p>
                    )}

                    {!isChecking && requiresAuthentication && check && (
                      <div className="mt-1">
                        <AuthMethodPrompt
                          authMethods={check.authMethods}
                          connectionId={check.connection.connectionId}
                          agentId={agent.registryId}
                          projectPath={check.projectPath}
                          onAuthFlowComplete={async () => {
                            await checkSingleAgent(agent.registryId)
                          }}
                        />
                      </div>
                    )}

                    {!isChecking && checkError && !requiresAuthentication && (
                      <p className="text-[11px] text-error mt-2 break-words whitespace-pre-line">{checkError}</p>
                    )}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isChecking}
                    onClick={() => checkSingleAgent(agent.registryId)}
                    className="shrink-0"
                  >
                    {check || checkError ? 'Check Again' : 'Check'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
