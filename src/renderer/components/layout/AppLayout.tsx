import React from 'react'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { Sidebar } from './Sidebar'
import { MainPanel } from './MainPanel'
import { ReviewPanel } from './ReviewPanel'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { DiffView } from '../diff/DiffView'
import { SettingsView } from '../settings/SettingsView'
import { AgentBrowserView } from '../registry/AgentBrowserView'
import { ThreadsOverview } from '../threads/ThreadsOverview'
import { useUiStore } from '../../stores/ui-store'
import { useRouteStore } from '../../stores/route-store'

export function AppLayout() {
  const terminalVisible = useUiStore((s) => s.terminalVisible)
  const terminalHeight = useUiStore((s) => s.terminalHeight)
  const currentRoute = useRouteStore((s) => s.current.route)

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* Top toolbar */}
      <Toolbar />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <Sidebar />

        {/* Main panel + terminal */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Main panel area */}
          <div className="flex flex-1 min-h-0">
            {currentRoute === 'diff' && <DiffView />}
            {currentRoute === 'settings' && <SettingsView />}
            {currentRoute === 'agents' && <AgentBrowserView />}
            {currentRoute === 'threads' && <ThreadsOverview />}
            {currentRoute === 'home' && (
              <>
                <MainPanel />
                <ReviewPanel />
              </>
            )}
          </div>

          {/* Terminal panel (bottom) */}
          {terminalVisible && (
            <div
              className="border-t border-border shrink-0"
              style={{ height: terminalHeight }}
            >
              <TerminalPanel />
            </div>
          )}
        </div>
      </div>

      {/* Bottom status bar */}
      <StatusBar />
    </div>
  )
}
