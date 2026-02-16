import React, { useEffect, useState, useCallback } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useUiStore } from '../../stores/ui-store'
import { DiffFileTree } from './DiffFileTree'
import { MonacoDiffEditor } from './MonacoDiffEditor'
import { Spinner } from '../common/Spinner'
import type { FileChange, DiffResult } from '@shared/types/project'

export function DiffView() {
  const activeSession = useSessionStore((s) => s.getActiveSession())
  const { diffViewSelectedFile, setDiffViewSelectedFile, closeDiffView } = useUiStore()

  const [changes, setChanges] = useState<FileChange[]>([])
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [sideBySide, setSideBySide] = useState(true)

  // Commit state
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<string | null>(null)

  const workingDir = activeSession?.workingDir

  // Fetch file changes on mount
  useEffect(() => {
    if (!workingDir) return
    setLoading(true)
    window.api
      .invoke('file:get-changes', { workingDir })
      .then((result) => {
        setChanges(result)
        // Auto-select first file if none selected
        if (!diffViewSelectedFile && result.length > 0) {
          setDiffViewSelectedFile(result[0].path)
        }
      })
      .catch(() => setChanges([]))
      .finally(() => setLoading(false))
  }, [workingDir, diffViewSelectedFile, setDiffViewSelectedFile])

  // Fetch diff when selected file changes
  useEffect(() => {
    if (!workingDir || !diffViewSelectedFile) {
      setDiff(null)
      return
    }
    setLoadingDiff(true)
    window.api
      .invoke('git:diff', {
        worktreePath: workingDir,
        filePath: diffViewSelectedFile
      })
      .then(setDiff)
      .catch(() => setDiff(null))
      .finally(() => setLoadingDiff(false))
  }, [workingDir, diffViewSelectedFile])

  // Compute totals
  const totalAdditions = changes.reduce((s, c) => s + c.additions, 0)
  const totalDeletions = changes.reduce((s, c) => s + c.deletions, 0)

  // Branch info
  const currentBranch = activeSession?.worktreeBranch || ''
  const baseBranch = 'main' // TODO: detect dynamically

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || !workingDir) return
    setCommitting(true)
    setCommitResult(null)
    try {
      const result = await window.api.invoke('git:commit', {
        worktreePath: workingDir,
        message: commitMessage.trim(),
        files: ['.']
      })
      setCommitResult(`Committed: ${result.hash.slice(0, 7)}`)
      setCommitMessage('')
      // Refresh changes
      const updated = await window.api.invoke('file:get-changes', { workingDir })
      setChanges(updated)
      if (updated.length === 0) {
        setDiffViewSelectedFile(null)
        setDiff(null)
      }
    } catch (error) {
      setCommitResult(`Error: ${(error as Error).message}`)
    } finally {
      setCommitting(false)
    }
  }, [commitMessage, workingDir, setDiffViewSelectedFile])

  const fileDiff = diff?.files[0]

  // Handle keyboard shortcut to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDiffView()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeDiffView])

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        No active session
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center px-3 py-1.5 border-b border-border bg-surface-1 shrink-0 gap-2">
        {/* Close button */}
        <button
          onClick={closeDiffView}
          className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
          title="Close diff view (Esc)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Title with stats */}
        <span className="text-sm font-medium text-text-primary">Diff</span>
        <span className="text-sm text-success font-mono">+{totalAdditions}</span>
        <span className="text-sm text-error font-mono">-{totalDeletions}</span>

        <div className="flex-1" />

        {/* Selected file path */}
        {diffViewSelectedFile && (
          <span className="text-xs font-mono text-text-muted truncate max-w-[400px]">
            {diffViewSelectedFile}
          </span>
        )}

        {/* Side-by-side toggle */}
        <button
          onClick={() => setSideBySide((v) => !v)}
          className={`p-1 rounded transition-colors ${
            sideBySide
              ? 'bg-surface-2 text-text-primary'
              : 'text-text-muted hover:bg-surface-2 hover:text-text-primary'
          }`}
          title={sideBySide ? 'Switch to inline view' : 'Switch to side-by-side view'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v16M15 4v16M4 4h16v16H4V4z" />
          </svg>
        </button>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* File tree sidebar */}
        <div className="w-[250px] shrink-0">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Spinner size="sm" />
            </div>
          ) : (
            <DiffFileTree
              changes={changes}
              selectedFile={diffViewSelectedFile}
              onSelectFile={setDiffViewSelectedFile}
            />
          )}
        </div>

        {/* Monaco diff editor */}
        <div className="flex-1 min-w-0">
          {loadingDiff ? (
            <div className="flex items-center justify-center h-full bg-surface-1">
              <Spinner size="sm" />
            </div>
          ) : fileDiff ? (
            <MonacoDiffEditor
              originalContent={fileDiff.oldContent}
              modifiedContent={fileDiff.newContent}
              filePath={diffViewSelectedFile || ''}
              sideBySide={sideBySide}
            />
          ) : (
            <div className="flex items-center justify-center h-full bg-surface-1 text-text-muted text-sm">
              {changes.length === 0 ? 'No changes to display' : 'Select a file to view diff'}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center px-3 py-1.5 border-t border-border bg-surface-1 shrink-0 gap-2">
        {/* Branch info */}
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          <span className="text-text-secondary">{baseBranch}</span>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-accent">{currentBranch}</span>
        </div>

        <div className="flex-1" />

        {/* Commit result */}
        {commitResult && (
          <span
            className={`text-[11px] ${
              commitResult.startsWith('Error') ? 'text-error' : 'text-success'
            }`}
          >
            {commitResult}
          </span>
        )}

        {/* Commit input + button */}
        <input
          type="text"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && commitMessage.trim()) handleCommit()
          }}
          placeholder="Commit message..."
          className="w-[300px] bg-surface-2 border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50"
        />
        <button
          onClick={handleCommit}
          disabled={!commitMessage.trim() || committing || changes.length === 0}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            !commitMessage.trim() || committing || changes.length === 0
              ? 'bg-surface-2 text-text-muted cursor-not-allowed'
              : 'bg-accent text-accent-text hover:bg-accent-hover'
          }`}
        >
          {committing ? 'Committing...' : 'Commit changes'}
        </button>
      </div>
    </div>
  )
}
