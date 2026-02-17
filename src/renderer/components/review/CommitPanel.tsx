import React, { useState } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { Button } from '../common/Button'

const COMMIT_ALL_PROMPT =
  'Commit all current changes in this workspace. Stage everything and create an appropriate commit message.'

export function CommitPanel() {
  const activeSession = useSessionStore((s) => s.getActiveSession())
  const sendPrompt = useSessionStore((s) => s.sendPrompt)
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  if (!activeSession) return null

  const canCommit =
    !committing &&
    activeSession.status !== 'creating' &&
    activeSession.status !== 'initializing'

  const handleCommit = async () => {
    if (!canCommit) return

    setCommitting(true)
    setResult(null)

    try {
      await sendPrompt([{ type: 'text', text: COMMIT_ALL_PROMPT }])
      setResult('Commit request sent to agent')
    } catch (error) {
      setResult(`Error: ${error instanceof Error ? error.message : 'Failed to send commit request'}`)
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="border-t border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={!canCommit}
          loading={committing}
          onClick={handleCommit}
        >
          Commit changes
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
