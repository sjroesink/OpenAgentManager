import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useUiStore } from '../../stores/ui-store'
import { Button } from '../common/Button'
import type { InteractionMode } from '@shared/types/session'

const MODE_CONFIG: Record<InteractionMode, { icon: React.ReactNode; label: string; description: string }> = {
  ask: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-1a2.5 2.5 0 015 0v1m0 0V14m0-2.5a2.5 2.5 0 015 0v1V14" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 110-18 9 9 0 010 18z" />
      </svg>
    ),
    label: 'Ask',
    description: 'Asks for approval for each action.'
  },
  code: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
    label: 'Code',
    description: 'Starts immediately.'
  },
  plan: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    label: 'Plan',
    description: 'Defines a plan before acting.'
  },
  act: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    label: 'Act',
    description: 'Takes all actions without asking.'
  }
}

const MODES: InteractionMode[] = ['ask', 'code', 'plan', 'act']

export function PromptInput() {
  const [text, setText] = useState('')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { activeSessionId, sendPrompt, getActiveSession } = useSessionStore()
  const { interactionMode, setInteractionMode } = useUiStore()

  const session = getActiveSession()
  const isInitializing = session?.status === 'initializing'
  const isCreating = session?.status === 'creating'
  const isPrompting = session?.status === 'prompting'
  const isBusy = isPrompting || isCreating || isInitializing
  const currentMode = MODE_CONFIG[interactionMode]

  // Close menu on outside click
  useEffect(() => {
    if (!modeMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setModeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [modeMenuOpen])

  const handleSubmit = useCallback(async () => {
    if (!text.trim() || !activeSessionId || isBusy) return

    const prompt = text.trim()
    setText('')

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    await sendPrompt(prompt, interactionMode)
  }, [text, activeSessionId, isBusy, sendPrompt, interactionMode])

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

  const selectMode = (mode: InteractionMode) => {
    setInteractionMode(mode)
    setModeMenuOpen(false)
  }

  if (!activeSessionId) return null

  return (
    <div className="border-t border-border p-3 bg-surface-0 shrink-0">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={isCreating && session?.pendingPrompt ? session.pendingPrompt : text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={isInitializing ? 'Launching agent...' : isCreating ? 'Setting up session...' : isPrompting ? 'Agent is working...' : 'Send a message... (Enter to send, Shift+Enter for new line)'}
            disabled={isBusy}
            readOnly={isInitializing || isCreating}
            rows={1}
            className="w-full bg-surface-1 border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-colors disabled:opacity-50"
            style={{ minHeight: '40px', maxHeight: '200px' }}
          />
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={!text.trim() || isBusy}
          onClick={handleSubmit}
          className="shrink-0 rounded-xl h-[40px] w-[40px] !p-0"
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

      {/* Bottom bar: mode selector */}
      <div className="flex items-center gap-1 max-w-3xl mx-auto mt-1.5">
        {/* Mode selector */}
        <div className="relative">
          <button
            ref={buttonRef}
            onClick={() => setModeMenuOpen(!modeMenuOpen)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-1 rounded-md transition-colors"
          >
            {currentMode.icon}
            <span>{currentMode.label}</span>
            <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {modeMenuOpen && (
            <div
              ref={menuRef}
              className="absolute bottom-full left-0 mb-1 w-64 bg-surface-2 border border-border rounded-lg shadow-lg py-1 z-50"
            >
              {MODES.map((mode) => {
                const config = MODE_CONFIG[mode]
                const isActive = mode === interactionMode
                return (
                  <button
                    key={mode}
                    onClick={() => selectMode(mode)}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-3 transition-colors ${
                      isActive ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">{config.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{config.label}</div>
                      <div className="text-xs text-text-muted">{config.description}</div>
                    </div>
                    {isActive && (
                      <svg className="w-4 h-4 text-accent shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
