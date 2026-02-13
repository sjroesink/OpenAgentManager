import React, { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useUiStore } from '../../stores/ui-store'
import type { FileChange } from '@shared/types/project'
import { Badge } from '../common/Badge'

export function FileChangeList() {
  const activeSession = useSessionStore((s) => s.getActiveSession())
  const { setSelectedDiffFile, setReviewTab } = useUiStore()
  const [changes, setChanges] = useState<FileChange[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (activeSession?.workingDir) {
      setLoading(true)
      window.api
        .invoke('file:get-changes', { workingDir: activeSession.workingDir })
        .then(setChanges)
        .catch(() => setChanges([]))
        .finally(() => setLoading(false))
    }
  }, [activeSession?.workingDir, activeSession?.status])

  const statusLabels: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'accent' }> = {
    added: { label: 'A', variant: 'success' },
    modified: { label: 'M', variant: 'warning' },
    deleted: { label: 'D', variant: 'error' },
    renamed: { label: 'R', variant: 'accent' }
  }

  if (!activeSession) {
    return <div className="p-4 text-xs text-text-muted text-center">No active session</div>
  }

  if (loading) {
    return <div className="p-4 text-xs text-text-muted text-center">Loading changes...</div>
  }

  if (changes.length === 0) {
    return <div className="p-4 text-xs text-text-muted text-center">No changes detected</div>
  }

  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-[10px] uppercase font-medium text-text-muted">
        {changes.length} file{changes.length !== 1 ? 's' : ''} changed
      </div>

      {changes.map((change) => {
        const info = statusLabels[change.status] || { label: '?', variant: 'default' as const }
        return (
          <button
            key={change.path}
            onClick={() => {
              setSelectedDiffFile(change.path)
              setReviewTab('diff')
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors text-left"
          >
            <Badge variant={info.variant}>{info.label}</Badge>
            <span className="truncate text-text-primary">{change.path}</span>
          </button>
        )
      })}
    </div>
  )
}
