import React, { useEffect, useCallback } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { AgentBrowser } from './components/registry/AgentBrowser'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { PermissionDialog } from './components/thread/PermissionDialog'
import { NewThreadDialog } from './components/sidebar/NewThreadDialog'
import { useSessionStore } from './stores/session-store'
import { useAgentStore } from './stores/agent-store'
import { useWorkspaceStore } from './stores/workspace-store'
import { useIpcEvent } from './hooks/useIpc'
import type { SessionUpdateEvent, PermissionRequestEvent } from '@shared/types/session'

export default function App() {
  const { handleSessionUpdate, handlePermissionRequest, loadPersistedSessions } = useSessionStore()
  const { updateConnectionStatus, loadInstalled } = useAgentStore()
  const { loadWorkspaces } = useWorkspaceStore()

  // Subscribe to IPC events from main process
  const onSessionUpdate = useCallback(
    (event: SessionUpdateEvent) => {
      handleSessionUpdate(event)
    },
    [handleSessionUpdate]
  )

  const onPermissionRequest = useCallback(
    (event: PermissionRequestEvent) => {
      handlePermissionRequest(event)
    },
    [handlePermissionRequest]
  )

  const onAgentStatusChange = useCallback(
    (event: { connectionId: string; status: string; error?: string }) => {
      updateConnectionStatus(
        event.connectionId,
        event.status as 'connected' | 'error' | 'terminated',
        event.error
      )
    },
    [updateConnectionStatus]
  )

  useIpcEvent('session:update', onSessionUpdate)
  useIpcEvent('session:permission-request', onPermissionRequest)
  useIpcEvent('agent:status-change', onAgentStatusChange)

  // Load installed agents, workspaces, and persisted sessions on startup
  useEffect(() => {
    loadInstalled()
    loadWorkspaces()
    loadPersistedSessions()
  }, [loadInstalled, loadWorkspaces, loadPersistedSessions])

  return (
    <>
      <AppLayout />
      <AgentBrowser />
      <SettingsDialog />
      <PermissionDialog />
      <NewThreadDialog />
    </>
  )
}
