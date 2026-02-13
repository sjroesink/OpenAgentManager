import React, { useState, useRef, useCallback } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { Button } from '../common/Button'

export function PromptInput() {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { activeSessionId, sendPrompt, getActiveSession } = useSessionStore()

  const session = getActiveSession()
  const isPrompting = session?.status === 'prompting'

  const handleSubmit = useCallback(async () => {
    if (!text.trim() || !activeSessionId || isPrompting) return

    const prompt = text.trim()
    setText('')

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    await sendPrompt(prompt)
  }, [text, activeSessionId, isPrompting, sendPrompt])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)

    // Auto-resize
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }

  if (!activeSessionId) return null

  return (
    <div className="border-t border-border p-3 bg-surface-0 shrink-0">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={isPrompting ? 'Agent is working...' : 'Send a message... (Enter to send, Shift+Enter for new line)'}
            disabled={isPrompting}
            rows={1}
            className="w-full bg-surface-1 border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-colors disabled:opacity-50"
            style={{ minHeight: '40px', maxHeight: '200px' }}
          />
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={!text.trim() || isPrompting}
          onClick={handleSubmit}
          className="shrink-0 rounded-xl"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </Button>
      </div>
    </div>
  )
}
