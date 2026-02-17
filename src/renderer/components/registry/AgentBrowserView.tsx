import React, { useEffect, useState } from 'react'
import { useAgentStore } from '../../stores/agent-store'
import { useRouteStore } from '../../stores/route-store'
import { Spinner } from '../common/Spinner'
import { AgentCard } from './AgentCard'

export function AgentBrowserView() {
  const { registry, registryLoading, registryError, fetchRegistry, loadInstalled } = useAgentStore()
  const navigate = useRouteStore((s) => s.navigate)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchRegistry()
    loadInstalled()
  }, [fetchRegistry, loadInstalled])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('home')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  const filteredAgents = (registry?.agents || []).filter(
    (agent) =>
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.description.toLowerCase().includes(search.toLowerCase()) ||
      agent.id.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center px-4 py-2 border-b border-border shrink-0 gap-2">
        <button
          onClick={() => navigate('home')}
          className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
          title="Close agent browser (Esc)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <span className="text-sm font-medium text-text-primary">ACP Agent Registry</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50"
          />

          {/* Loading state */}
          {registryLoading && (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          )}

          {/* Error state */}
          {registryError && (
            <div className="text-sm text-error text-center py-4">
              Failed to load registry: {registryError}
            </div>
          )}

          {/* Agent list */}
          {!registryLoading && !registryError && (
            <div className="space-y-3">
              {filteredAgents.length === 0 ? (
                <div className="text-sm text-text-muted text-center py-4">
                  {search ? 'No agents match your search' : 'No agents available'}
                </div>
              ) : (
                <>
                  <div className="text-xs text-text-muted">
                    {filteredAgents.length} agent{filteredAgents.length !== 1 ? 's' : ''} available
                  </div>
                  {filteredAgents.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
