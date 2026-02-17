import React, { useEffect, useCallback } from 'react'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { AppLayout } from './components/layout/AppLayout'
import { PermissionDialog } from './components/thread/PermissionDialog'
import { useSessionStore } from './stores/session-store'
import { useAgentStore } from './stores/agent-store'
import { useWorkspaceStore } from './stores/workspace-store'
import { useAcpFeaturesStore } from './stores/acp-features-store'
import { useRouteStore } from './stores/route-store'
import { useIpcEvent } from './hooks/useIpc'
import { useTheme } from './hooks/useTheme'
import type { SessionUpdateEvent, PermissionRequestEvent, PermissionResolvedEvent, WorktreeHookProgressEvent } from '@shared/types/session'

export default function App() {
  const {
    handleSessionUpdate,
    handlePermissionRequest,
    handlePermissionResolved,
    handleHookProgress,
    loadPersistedSessions,
    setActiveSession,
    setActiveDraft,
    activeSessionId,
    activeDraftId,
    draftThread
  } = useSessionStore()
  const { updateConnectionStatus, loadInstalled, fetchRegistry } = useAgentStore()
  const { loadWorkspaces } = useWorkspaceStore()
  const { applyUpdate: applyAcpUpdate } = useAcpFeaturesStore()
  const currentRoute = useRouteStore((s) => s.current)

  // Apply theme from settings (dark/light/system)
  useTheme()

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

  const onPermissionResolved = useCallback(
    (event: PermissionResolvedEvent) => {
      handlePermissionResolved(event)
    },
    [handlePermissionResolved]
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
  useIpcEvent('session:permission-resolved', onPermissionResolved)
  useIpcEvent('session:hook-progress', onHookProgress)
  useIpcEvent('agent:status-change', onAgentStatusChange)

  // Load installed agents, workspaces, and persisted sessions on startup
  useEffect(() => {
    loadInstalled()
    fetchRegistry()
    loadWorkspaces()
    loadPersistedSessions()
  }, [loadInstalled, fetchRegistry, loadWorkspaces, loadPersistedSessions])

  // Check if onboarding needs to be shown on first launch
  useEffect(() => {
    window.api.invoke('settings:get', undefined).then((settings) => {
      if (!settings.general.completedOnboarding) {
        useRouteStore.getState().navigate('onboarding')
      }
    })
  }, [])

  // Global keyboard shortcuts for navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+D — toggle diff view
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        const routeState = useRouteStore.getState()
        routeState.navigate(routeState.current.route === 'diff' ? 'home' : 'diff')
      }
      // Alt+Left — go back
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        useRouteStore.getState().goBack()
      }
      // Alt+Right — go forward
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        useRouteStore.getState().goForward()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Mouse XButton1 / XButton2 navigation (browser-style back/forward)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        useRouteStore.getState().goBack()
      }
      if (e.button === 4) {
        e.preventDefault()
        useRouteStore.getState().goForward()
      }
    }
    window.addEventListener('mouseup', handler)
    return () => window.removeEventListener('mouseup', handler)
  }, [])

  // Sync history route entry -> active session selection
  useEffect(() => {
    if (currentRoute.route !== 'home') return
    const routeSessionId = currentRoute.params?.sessionId
    if (!routeSessionId || routeSessionId === activeSessionId) return
    setActiveSession(routeSessionId)
  }, [currentRoute, activeSessionId, setActiveSession])

  // Sync history route entry -> active draft selection
  useEffect(() => {
    if (currentRoute.route !== 'new-thread') return
    const routeDraftId = currentRoute.params?.draftId
    if (!routeDraftId || !draftThread || draftThread.id !== routeDraftId) return
    if (activeDraftId === routeDraftId && activeSessionId === null) return
    setActiveDraft(routeDraftId)
  }, [currentRoute, draftThread, activeDraftId, activeSessionId, setActiveDraft])

  return (
    <ErrorBoundary>
      <AppLayout />
      <ErrorBoundary fallback={null}>
        <PermissionDialog />
      </ErrorBoundary>
    </ErrorBoundary>
  )
}
