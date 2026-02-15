import React from 'react'
import { useUiStore } from '../../stores/ui-store'
import { Tabs } from '../common/Tabs'
import { FileChangeList } from '../review/FileChangeList'
import { DiffViewer } from '../review/DiffViewer'
import { CommitPanel } from '../review/CommitPanel'

export function ReviewPanel() {
  const { reviewPanelVisible, reviewPanelWidth, reviewTab, setReviewTab, selectedDiffFile, openDiffView } = useUiStore()

  if (!reviewPanelVisible) return null

  return (
    <div
      className="flex flex-col bg-surface-1 border-l border-border shrink-0 h-full"
      style={{ width: reviewPanelWidth }}
    >
      <div className="flex items-center">
        <Tabs
          tabs={[
            { id: 'changes', label: 'Changes' },
            { id: 'diff', label: 'Diff' }
          ]}
          activeTab={reviewTab}
          onTabChange={(tab) => setReviewTab(tab as 'changes' | 'diff')}
          className="px-2 pt-1 flex-1"
        />
        <button
          onClick={() => openDiffView(selectedDiffFile ?? undefined)}
          className="p-1 mr-2 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
          title="Open full diff view"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {reviewTab === 'changes' ? <FileChangeList /> : <DiffViewer />}
      </div>

      <CommitPanel />
    </div>
  )
}
