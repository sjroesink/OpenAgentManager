import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useIpcEvent } from '../../hooks/useIpc'
import { Button } from '../common/Button'

/**
 * Terminal panel using a simple pre-based terminal display.
 * In production, this would use xterm.js for full terminal emulation.
 * This is a simplified version that works without native dependencies.
 */
export function TerminalPanel() {
  const activeSession = useSessionStore((s) => s.getActiveSession())
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const [input, setInput] = useState('')
  const outputRef = useRef<HTMLPreElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Create terminal when session is active
  useEffect(() => {
    if (activeSession && !terminalId) {
      window.api
        .invoke('terminal:create', {
          cwd: activeSession.workingDir,
          sessionId: activeSession.sessionId
        })
        .then(setTerminalId)
        .catch((err) => {
          setOutput(`Terminal error: ${err.message}\n`)
        })
    }
  }, [activeSession, terminalId])

  // Listen for terminal output
  const handleTerminalData = useCallback(
    (data: { terminalId: string; data: string }) => {
      if (data.terminalId === terminalId) {
        setOutput((prev) => prev + data.data)
      }
    },
    [terminalId]
  )

  useIpcEvent('terminal:data', handleTerminalData)

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const handleInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && terminalId) {
      window.api.invoke('terminal:write', { terminalId, data: input + '\r' })
      setInput('')
    }
  }

  if (!activeSession) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-text-muted">
        No active session for terminal
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-surface-0">
      {/* Terminal header */}
      <div className="flex items-center px-3 py-1 border-b border-border bg-surface-1 shrink-0">
        <span className="text-xs text-text-secondary font-mono">Terminal</span>
        <span className="text-[10px] text-text-muted ml-2">{activeSession.workingDir}</span>
        <div className="flex-1" />
        {terminalId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              window.api.invoke('terminal:kill', { terminalId })
              setTerminalId(null)
              setOutput('')
            }}
          >
            Kill
          </Button>
        )}
      </div>

      {/* Output area */}
      <pre
        ref={outputRef}
        className="flex-1 overflow-auto px-3 py-2 font-mono text-xs text-text-primary whitespace-pre-wrap"
        onClick={() => inputRef.current?.focus()}
      >
        {output || 'Terminal ready.\n'}
      </pre>

      {/* Input */}
      <div className="flex items-center px-3 py-1 border-t border-border bg-surface-1 shrink-0">
        <span className="text-xs text-accent mr-2">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleInput}
          className="flex-1 bg-transparent text-xs font-mono text-text-primary outline-none"
          placeholder="Enter command..."
        />
      </div>
    </div>
  )
}
