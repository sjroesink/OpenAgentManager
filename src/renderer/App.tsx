import React, { useEffect, useCallback } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { AgentBrowser } from './components/registry/AgentBrowser'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { PermissionDialog } from './components/thread/PermissionDialog'
import { useSessionStore } from './stores/session-store'
import { useAgentStore } from './stores/agent-store'
import { useWorkspaceStore } from './stores/workspace-store'
import { useAcpFeaturesStore } from './stores/acp-features-store'
import { useUiStore } from './stores/ui-store'
import { useIpcEvent } from './hooks/useIpc'
import type { SessionUpdateEvent, PermissionRequestEvent, WorktreeHookProgressEvent } from '@shared/types/session'

export default function App() {
  const { handleSessionUpdate, handlePermissionRequest, handleHookProgress, loadPersistedSessions } = useSessionStore()
  const { updateConnectionStatus, loadInstalled } = useAgentStore()
  const { loadWorkspaces } = useWorkspaceStore()
  const { applyUpdate: applyAcpUpdate } = useAcpFeaturesStore()

  // Subscribe to IPC events from main process
  const onSessionUpdate = useCallback(
    (event: SessionUpdateEvent) => {
      handleSessionUpdate(event)
      // Also forward to ACP features store for mode/config/plan/usage tracking
      applyAcpUpdate(event.sessionId, event.update)
    },
    [handleSessionUpdate, applyAcpUpdate]
  )

  const onPermissionRequest = useCallback(
    (event: PermissionRequestEvent) => {
      handlePermissionRequest(event)
    },
    [handlePermissionRequest]
  )

  const onHookProgress = useCallback(
    (event: WorktreeHookProgressEvent) => {
      handleHookProgress(event)
    },
    [handleHookProgress]
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
  useIpcEvent('session:hook-progress', onHookProgress)
  useIpcEvent('agent:status-change', onAgentStatusChange)

  // Load installed agents, workspaces, and persisted sessions on startup
  useEffect(() => {
    loadInstalled()
    loadWorkspaces()
    loadPersistedSessions()
  }, [loadInstalled, loadWorkspaces, loadPersistedSessions])

  // Global keyboard shortcut for diff view
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        const store = useUiStore.getState()
        if (store.diffViewOpen) {
          store.closeDiffView()
        } else {
          store.openDiffView()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <AppLayout />
      <AgentBrowser />
      <SettingsDialog />
      <PermissionDialog />
    </>
  )
}
