import React, { useState, useRef, useEffect } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useSessionStore } from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useRouteStore } from '../../stores/route-store'
import { Button } from '../common/Button'

interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  separator?: boolean
}

interface MenuGroup {
  label: string
  items: MenuItem[]
}

function useAppMenu(): MenuGroup[] {
  const { toggleSidebar, toggleReviewPanel, toggleTerminal } = useUiStore()
  const { navigate } = useRouteStore()
  const currentRoute = useRouteStore((s) => s.current.route)

  return [
    {
      label: 'File',
      items: [
        { label: 'Settings', shortcut: 'Ctrl+,', action: () => navigate('settings') },
        { label: '', separator: true },
        { label: 'Close Window', shortcut: 'Ctrl+W', action: () => window.api.invoke('window:close', undefined) },
        { label: 'Quit', shortcut: 'Ctrl+Q', action: () => window.api.invoke('window:quit', undefined) }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => document.execCommand('undo') },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => document.execCommand('redo') },
        { label: '', separator: true },
        { label: 'Cut', shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => document.execCommand('paste') },
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => document.execCommand('selectAll') }
      ]
    },
    {
      label: 'View',
      items: [
        { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: toggleSidebar },
        { label: 'Toggle Review Panel', action: toggleReviewPanel },
        { label: 'Toggle Terminal', shortcut: 'Ctrl+`', action: toggleTerminal },
        {
          label: 'Diff View',
          shortcut: 'Ctrl+Shift+D',
          action: () => navigate(currentRoute === 'diff' ? 'home' : 'diff')
        },
        { label: 'Agent Registry', action: () => navigate('agents') },
        { label: '', separator: true },
        { label: 'Zoom In', shortcut: 'Ctrl+=', action: () => window.api.invoke('window:zoom-in', undefined) },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', action: () => window.api.invoke('window:zoom-out', undefined) },
        { label: 'Reset Zoom', shortcut: 'Ctrl+0', action: () => window.api.invoke('window:reset-zoom', undefined) },
        { label: '', separator: true },
        { label: 'Toggle Fullscreen', shortcut: 'F11', action: () => window.api.invoke('window:toggle-fullscreen', undefined) }
      ]
    },
    {
      label: 'Window',
      items: [
        { label: 'Minimize', action: () => window.api.invoke('window:minimize', undefined) },
        { label: 'Reload', shortcut: 'Ctrl+Shift+R', action: () => window.api.invoke('window:reload', undefined) },
        { label: 'Toggle Developer Tools', shortcut: 'F12', action: () => window.api.invoke('window:toggle-devtools', undefined) }
      ]
    },
    {
      label: 'Help',
      items: [
        { label: 'About AgentManager' }
      ]
    }
  ]
}

function MenuBar({ onClose }: { onClose: () => void }) {
  const menuGroups = useAppMenu()
  const [activeGroup, setActiveGroup] = useState<number>(0)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const activeItems = menuGroups[activeGroup]?.items ?? []

  return (
    <div ref={menuRef} className="absolute top-10 left-0 z-50 flex shadow-xl">
      {/* Menu group tabs */}
      <div className="flex flex-col bg-surface-2 border border-border rounded-l-lg min-w-[120px]">
        {menuGroups.map((group, i) => (
          <button
            key={group.label}
            className={`text-left px-4 py-2 text-sm transition-colors ${
              i === activeGroup
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary'
            }`}
            onMouseEnter={() => setActiveGroup(i)}
            onClick={() => setActiveGroup(i)}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/* Active group items */}
      <div className="bg-surface-2 border border-l-0 border-border rounded-r-lg min-w-[220px] py-1">
        {activeItems.map((item, i) =>
          item.separator ? (
            <div key={`sep-${i}`} className="border-t border-border my-1" />
          ) : (
            <button
              key={item.label}
              className="flex items-center justify-between w-full px-4 py-1.5 text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors"
              onClick={() => {
                item.action?.()
                onClose()
              }}
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <span className="text-xs text-text-muted ml-6">{item.shortcut}</span>
              )}
            </button>
          )
        )}
      </div>
    </div>
  )
}

export function Toolbar() {
  const { toggleSidebar, toggleTerminal } = useUiStore()
  const { navigate, goBack, goForward, canGoBack, canGoForward } = useRouteStore()
  const currentRoute = useRouteStore((s) => s.current.route)

  const activeSession = useSessionStore((s) => s.getActiveSession())
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspace = activeSession
    ? workspaces.find((w) => w.id === activeSession.workspaceId)
    : null

  const isMac = navigator.platform.toLowerCase().includes('mac')

  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="titlebar-drag flex items-center h-10 px-3 bg-surface-1 border-b border-border gap-2 shrink-0 relative">
      {/* macOS traffic light spacer */}
      {isMac && <div className="w-16 shrink-0" />}

      {/* Hamburger menu button */}
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="titlebar-no-drag p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
        title="Menu"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar toggle button */}
      <button
        onClick={toggleSidebar}
        className="titlebar-no-drag p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
        title="Toggle sidebar (Ctrl+B)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16v16H4V4z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v16" />
        </svg>
      </button>

      {/* Back button */}
      <button
        onClick={goBack}
        disabled={!canGoBack}
        className="titlebar-no-drag p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent"
        title="Go back (Alt+Left)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Forward button */}
      <button
        onClick={goForward}
        disabled={!canGoForward}
        className="titlebar-no-drag p-1.5 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent"
        title="Go forward (Alt+Right)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {menuOpen && <MenuBar onClose={() => setMenuOpen(false)} />}

      {/* Active workspace name */}
      {activeWorkspace && (
        <div className="titlebar-no-drag flex items-center gap-1.5 px-2 py-1 text-sm text-text-secondary">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          <span className="max-w-[200px] truncate">{activeWorkspace.name}</span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Agent Registry */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('agents')}
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
        onClick={() => navigate('settings')}
        className={`titlebar-no-drag p-1.5 rounded transition-colors ${
          currentRoute === 'settings'
            ? 'bg-accent/20 text-accent'
            : 'hover:bg-surface-2 text-text-secondary hover:text-text-primary'
        }`}
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
