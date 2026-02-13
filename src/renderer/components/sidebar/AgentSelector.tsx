import React, { useState, useRef, useEffect } from 'react'
import { useAgentStore } from '../../stores/agent-store'
import type { InstalledAgent } from '@shared/types/agent'

interface AgentSelectorProps {
  selectedAgentId: string | null
  onSelect: (agent: InstalledAgent) => void
}

export function AgentSelector({ selectedAgentId, onSelect }: AgentSelectorProps) {
  const installed = useAgentStore((s) => s.installed)
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedAgent = installed.find((a) => a.registryId === selectedAgentId)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (installed.length === 0) {
    return (
      <div className="text-xs text-text-muted p-2">
        No agents installed. Install one from the registry.
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-surface-2 hover:bg-surface-3 rounded-md border border-border transition-colors"
      >
        <span className="w-4 h-4 rounded bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0">
          {(selectedAgent?.name || 'A')[0]}
        </span>
        <span className="flex-1 text-left truncate">
          {selectedAgent?.name || 'Select Agent'}
        </span>
        <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-2 border border-border rounded-md shadow-xl z-50 max-h-60 overflow-y-auto">
          {installed.map((agent) => (
            <button
              key={agent.registryId}
              onClick={() => {
                onSelect(agent)
                setIsOpen(false)
              }}
              className={`
                w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                hover:bg-surface-3 transition-colors
                ${agent.registryId === selectedAgentId ? 'bg-accent/10 text-accent' : 'text-text-primary'}
              `}
            >
              <span className="w-4 h-4 rounded bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent shrink-0">
                {agent.name[0]}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{agent.name}</div>
                <div className="text-xs text-text-muted truncate">{agent.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
