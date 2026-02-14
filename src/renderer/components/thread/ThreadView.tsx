import React, { useEffect, useRef } from 'react'
import type { SessionInfo } from '@shared/types/session'
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
  }, [session.messages])

  const isInitializing = session.status === 'initializing'
  const isInitError = session.status === 'error' && !!session.initError

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
        </div>
      )}
    </div>
  )
}
