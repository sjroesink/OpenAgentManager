import React from 'react'
import { useUiStore } from '../../stores/ui-store'
import { Tabs } from '../common/Tabs'
import { ThreadList } from '../sidebar/ThreadList'
import { FileExplorer } from '../sidebar/FileExplorer'

export function Sidebar() {
  const { sidebarVisible, sidebarWidth, sidebarTab, setSidebarTab } = useUiStore()

  if (!sidebarVisible) return null

  return (
    <div
      className="flex flex-col bg-surface-1 border-r border-border shrink-0 h-full"
      style={{ width: sidebarWidth }}
    >
      <Tabs
        tabs={[
          { id: 'threads', label: 'Threads' },
          { id: 'files', label: 'Files' }
        ]}
        activeTab={sidebarTab}
        onTabChange={(tab) => setSidebarTab(tab as 'threads' | 'files')}
        className="px-2 pt-1"
      />

      <div className="flex-1 overflow-y-auto">
        {sidebarTab === 'threads' ? <ThreadList /> : <FileExplorer />}
      </div>
    </div>
  )
}
