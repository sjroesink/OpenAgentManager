import React, { useCallback } from 'react'
import type { AuthMethod } from '@shared/types/agent'
import { useSessionStore } from '../../stores/session-store'
import { Dialog } from '../common/Dialog'
import { AuthMethodPrompt } from './AuthMethodPrompt'

interface ReAuthDialogProps {
  open: boolean
  onClose: () => void
  authMethods: AuthMethod[]
  connectionId: string
  agentId: string
  agentName: string
  projectPath: string
  sessionId: string
}

export function ReAuthDialog({
  open,
  onClose,
  authMethods,
  connectionId,
  agentId,
  agentName,
  projectPath,
  sessionId
}: ReAuthDialogProps) {
  const handleAuthFlowComplete = useCallback(async () => {
    // Clear any existing error and reconnect the session
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId
          ? { ...s, status: 'active' as const, lastError: undefined }
          : s
      )
    }))
    try {
      await window.api.invoke('session:ensure-connected', { sessionId })
    } catch {
      // If reconnect fails, the session will show an error via IPC events
    }
    onClose()
  }, [sessionId, onClose])

  return (
    <Dialog open={open} onClose={onClose} title="Re-authenticate">
      <p className="text-sm text-text-secondary mb-4">
        Choose an authentication method for <span className="font-medium text-text-primary">{agentName}</span>.
      </p>
      <AuthMethodPrompt
        authMethods={authMethods}
        connectionId={connectionId}
        agentId={agentId}
        projectPath={projectPath}
        onAuthFlowComplete={handleAuthFlowComplete}
      />
    </Dialog>
  )
}
