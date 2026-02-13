import React from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../common/Button'

export function Toolbar() {
  const {
    sidebarVisible,
    toggleSidebar,
    toggleReviewPanel,
    toggleTerminal,
    setRegistryBrowserOpen,
    setSettingsOpen
  } = useUiStore()
  const { project, selectDirectory } = useProjectStore()

  return (
    <div className="titlebar-drag flex items-center h-10 px-3 bg-surface-1 border-b border-border gap-2 shrink-0">
      {/* macOS traffic light spacer */}
      <div className="w-16 shrink-0" />

      {/* Sidebar toggle */}
      <button
        onClick={toggleSidebar}
        className="titlebar-no-drag p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
        title="Toggle sidebar"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Project name / Open project */}
      <button
        onClick={selectDirectory}
        className="titlebar-no-drag flex items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span className="max-w-[200px] truncate">
          {project ? project.name : 'Open Project'}
        </span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Agent Registry */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setRegistryBrowserOpen(true)}
        className="titlebar-no-drag"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
          />
        </svg>
        Agents
      </Button>

      {/* Toggle panels */}
      <button
        onClick={toggleReviewPanel}
        className="titlebar-no-drag p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
        title="Toggle review panel"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </button>

      <button
        onClick={toggleTerminal}
        className="titlebar-no-drag p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
        title="Toggle terminal"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {/* Settings */}
      <button
        onClick={() => setSettingsOpen(true)}
        className="titlebar-no-drag p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
        title="Settings"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </div>
  )
}
