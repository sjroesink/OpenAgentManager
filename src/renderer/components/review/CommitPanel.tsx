import React, { useState } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { Button } from '../common/Button'

export function CommitPanel() {
  const activeSession = useSessionStore((s) => s.getActiveSession())
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  if (!activeSession) return null

  const handleCommit = async () => {
    if (!message.trim() || !activeSession.workingDir) return

    setCommitting(true)
    setResult(null)

    try {
      const commitResult = await window.api.invoke('git:commit', {
        worktreePath: activeSession.workingDir,
        message: message.trim(),
        files: ['.'] // Stage all changes
      })
      setResult(`Committed: ${commitResult.hash.slice(0, 7)}`)
      setMessage('')
    } catch (error) {
      setResult(`Error: ${(error as Error).message}`)
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="border-t border-border p-3 space-y-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message..."
        rows={2}
        className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-xs text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent/50"
      />
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={!message.trim() || committing}
          loading={committing}
          onClick={handleCommit}
        >
          Commit
        </Button>
      </div>
      {result && (
        <div className={`text-[11px] ${result.startsWith('Error') ? 'text-error' : 'text-success'}`}>
          {result}
        </div>
      )}
    </div>
  )
}
