import React from 'react'
import { useUiStore } from '../../stores/ui-store'
import { Tabs } from '../common/Tabs'
import { FileChangeList } from '../review/FileChangeList'
import { DiffViewer } from '../review/DiffViewer'
import { CommitPanel } from '../review/CommitPanel'

export function ReviewPanel() {
  const { reviewPanelVisible, reviewPanelWidth, reviewTab, setReviewTab } = useUiStore()

  if (!reviewPanelVisible) return null

  return (
    <div
      className="flex flex-col bg-surface-1 border-l border-border shrink-0 h-full"
      style={{ width: reviewPanelWidth }}
    >
      <Tabs
        tabs={[
          { id: 'changes', label: 'Changes' },
          { id: 'diff', label: 'Diff' }
        ]}
        activeTab={reviewTab}
        onTabChange={(tab) => setReviewTab(tab as 'changes' | 'diff')}
        className="px-2 pt-1"
      />

      <div className="flex-1 overflow-y-auto">
        {reviewTab === 'changes' ? <FileChangeList /> : <DiffViewer />}
      </div>

      <CommitPanel />
    </div>
  )
}
