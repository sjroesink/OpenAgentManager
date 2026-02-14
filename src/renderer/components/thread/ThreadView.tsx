import React, { useEffect, useRef } from 'react'
import type { SessionInfo } from '@shared/types/session'
import { useAgentStore } from '../../stores/agent-store'
import { MessageBubble } from './MessageBubble'
import { InitializationProgress } from './InitializationProgress'
import { Spinner } from '../common/Spinner'

interface ThreadViewProps {
  session: SessionInfo
}

export function ThreadView({ session }: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session.messages, session.lastError])

  const isInitializing = session.status === 'initializing'
  const isInitError = session.status === 'error' && !!session.initError

  // Get auth methods from the agent connection (if any)
  const connection = useAgentStore((s) =>
    s.connections.find((c) => c.connectionId === session.connectionId)
  )
  const authMethods = connection?.authMethods

  const showPromptError =
    session.status === 'error' && !!session.lastError && !session.initError

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
      {isInitializing || isInitError ? (
        <div className="flex flex-col items-center justify-center h-full">
          <InitializationProgress session={session} />
        </div>
      ) : session.messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm">
          <p>Send a message to get started</p>
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl mx-auto">
          {session.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {session.status === 'prompting' && (
            <div className="flex items-center gap-2 text-text-muted text-sm py-2">
              <Spinner size="sm" />
              <span>Agent is thinking...</span>
            </div>
          )}

          {showPromptError && (
            <ErrorBanner
              error={session.lastError!}
              authMethods={authMethods}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ErrorBanner({
  error,
  authMethods
}: {
  error: string
  authMethods?: { id: string; name: string; description?: string }[]
}) {
  const looksLikeAuthError =
    authMethods &&
    authMethods.length > 0 &&
    /auth|login|unauthorized|credential|api.key|token|forbidden|401|403/i.test(error)

  return (
    <div className="bg-error/10 border border-error/20 rounded-xl px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <svg
          className="w-4 h-4 text-error shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-error font-medium">Error</p>
          <p className="text-text-secondary mt-0.5 break-words">{error}</p>

          {looksLikeAuthError && (
            <div className="mt-2 pt-2 border-t border-error/10">
              <p className="text-text-secondary font-medium text-xs mb-1">
                Authentication required
              </p>
              {authMethods!.map((method) => (
                <div
                  key={method.id}
                  className="text-xs text-text-muted mt-0.5"
                >
                  <span className="font-medium text-text-secondary">
                    {method.name}
                  </span>
                  {method.description && (
                    <span className="ml-1">&mdash; {method.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
