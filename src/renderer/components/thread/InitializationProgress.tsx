import React from 'react'
import type { AuthMethod } from '@shared/types/agent'
import type { SessionInfo, HookStep } from '@shared/types/session'
import { useSessionStore } from '../../stores/session-store'
import { Spinner } from '../common/Spinner'
import { AuthMethodPrompt } from './AuthMethodPrompt'

interface InitializationProgressProps {
  session: SessionInfo
  authMethods?: AuthMethod[]
  connectionId?: string
  onAuthFlowComplete?: () => Promise<void> | void
}

export function InitializationProgress({
  session,
  authMethods,
  connectionId,
  onAuthFlowComplete
}: InitializationProgressProps) {
  const steps = session.initProgress || []
  const isError = session.status === 'error' && !!session.initError
  const hasRunningStep = steps.some((s) => s.status === 'running')
  const showAuthPrompt =
    isError &&
    !!connectionId &&
    !!authMethods?.length &&
    /auth|login|unauthorized|credential|api.?key|token|forbidden|401|403/i.test(session.initError || '')

  // Hook progress sub-steps (worktree setup, symlinks, etc.)
  // The main process emits these with the real session ID during session:create.
  // Since only one session initializes at a time, grab the latest event with steps.
  const hookSteps = useSessionStore((s) => {
    const entries = Object.values(s.hookProgress)
    const latest = entries.find((e) => e.steps && e.steps.length > 0)
    return latest?.steps ?? null
  })

  // Show hook sub-steps when "Creating session" is running
  const creatingStep = steps.find((s) => s.label === 'Creating session')
  const showHookSteps = creatingStep?.status === 'running' && hookSteps && hookSteps.length > 0

  const handleRetry = () => {
    useSessionStore.getState().retryInitialization(session.sessionId)
  }

  return (
    <div className="w-full max-w-md">
      {/* Progress steps */}
      <div className="bg-surface-1 rounded-xl px-5 py-4 border border-border">
        <div className="flex items-center gap-2 mb-3">
          {hasRunningStep && <Spinner size="sm" />}
          <span className="text-sm font-medium text-text-primary">
            {isError ? 'Initialization failed' : 'Setting up agent...'}
          </span>
        </div>

        <div className="space-y-1.5">
          {steps.map((step, i) => (
            <React.Fragment key={i}>
              <StepRow step={step} />
              {/* Show hook sub-steps indented under "Creating session" */}
              {step.label === 'Creating session' && showHookSteps && (
                <div className="ml-6 space-y-1">
                  {hookSteps.map((hookStep, j) => (
                    <StepRow key={j} step={hookStep} />
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Error message + retry */}
        {isError && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-error mb-2 break-words whitespace-pre-line">{session.initError}</p>
            {showAuthPrompt && (
              <div className="mb-2 rounded-lg border border-border bg-surface-2 p-2">
                <AuthMethodPrompt
                  authMethods={authMethods!}
                  connectionId={connectionId!}
                  agentId={session.agentId}
                  projectPath={session.workingDir}
                  onAuthFlowComplete={onAuthFlowComplete}
                />
              </div>
            )}
            <button
              onClick={handleRetry}
              className="text-xs text-accent hover:text-accent-hover font-medium"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function StepRow({ step }: { step: HookStep }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="mt-0.5 shrink-0 w-4 h-4 flex items-center justify-center">
        {step.status === 'completed' && (
          <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {step.status === 'running' && (
          <svg className="w-3.5 h-3.5 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {step.status === 'failed' && (
          <svg className="w-3.5 h-3.5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        {step.status === 'pending' && (
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <span
          className={`text-xs ${
            step.status === 'running'
              ? 'text-text-primary'
              : step.status === 'failed'
                ? 'text-error'
                : 'text-text-secondary'
          }`}
        >
          {step.label}
        </span>
        {step.status === 'running' && step.detail && (
          <p className="text-[10px] text-text-muted mt-0.5">{step.detail}</p>
        )}
        {step.status === 'failed' && step.detail && (
          <p className="text-[10px] text-error/70 truncate">{step.detail}</p>
        )}
      </div>
    </div>
  )
}
