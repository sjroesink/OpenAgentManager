import React, { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { useSessionStore } from '../../stores/session-store'
import type { DiffResult } from '@shared/types/project'
import { Spinner } from '../common/Spinner'

export function DiffViewer() {
  const selectedDiffFile = useUiStore((s) => s.selectedDiffFile)
  const activeSession = useSessionStore((s) => s.getActiveSession())
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (activeSession?.workingDir && selectedDiffFile) {
      setLoading(true)
      window.api
        .invoke('git:diff', {
          worktreePath: activeSession.workingDir,
          filePath: selectedDiffFile
        })
        .then(setDiff)
        .catch(() => setDiff(null))
        .finally(() => setLoading(false))
    }
  }, [activeSession?.workingDir, selectedDiffFile])

  if (!selectedDiffFile) {
    return (
      <div className="p-4 text-xs text-text-muted text-center">
        Select a changed file to view diff
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <Spinner size="sm" />
      </div>
    )
  }

  if (!diff || diff.files.length === 0) {
    return (
      <div className="p-4 text-xs text-text-muted text-center">
        No diff available for {selectedDiffFile}
      </div>
    )
  }

  const fileDiff = diff.files[0]

  return (
    <div className="h-full flex flex-col">
      {/* File header */}
      <div className="px-3 py-2 border-b border-border text-xs font-mono text-text-secondary bg-surface-2">
        {selectedDiffFile}
      </div>

      {/* Simple inline diff view */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        <SimpleDiffView
          oldContent={fileDiff.oldContent}
          newContent={fileDiff.newContent}
        />
      </div>
    </div>
  )
}

/** Simple line-by-line diff viewer */
function SimpleDiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  // Simple diff: show added and removed lines
  // For a real implementation, use a diff algorithm
  const lines: Array<{ type: 'same' | 'add' | 'remove'; text: string; lineNo: number }> = []

  // Very basic diff - in production, use a proper diff library
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)

  // Show removed lines
  for (let i = 0; i < oldLines.length; i++) {
    if (!newSet.has(oldLines[i])) {
      lines.push({ type: 'remove', text: oldLines[i], lineNo: i + 1 })
    }
  }

  // Show new content with additions highlighted
  for (let i = 0; i < newLines.length; i++) {
    if (!oldSet.has(newLines[i])) {
      lines.push({ type: 'add', text: newLines[i], lineNo: i + 1 })
    } else {
      lines.push({ type: 'same', text: newLines[i], lineNo: i + 1 })
    }
  }

  // Sort by line number
  lines.sort((a, b) => a.lineNo - b.lineNo)

  return (
    <div>
      {lines.map((line, i) => (
        <div
          key={i}
          className={`
            flex px-2 py-0 leading-5 border-l-2
            ${line.type === 'add' ? 'bg-success/10 border-success text-success' : ''}
            ${line.type === 'remove' ? 'bg-error/10 border-error text-error line-through' : ''}
            ${line.type === 'same' ? 'border-transparent text-text-secondary' : ''}
          `}
        >
          <span className="w-8 text-right pr-2 text-text-muted select-none shrink-0">
            {line.lineNo}
          </span>
          <span className="w-4 text-center shrink-0">
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
          </span>
          <span className="flex-1 whitespace-pre">{line.text}</span>
        </div>
      ))}
    </div>
  )
}
