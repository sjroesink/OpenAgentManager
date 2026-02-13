import React, { useEffect, useState } from 'react'
import { useAgentStore } from '../../stores/agent-store'
import { useUiStore } from '../../stores/ui-store'
import { Dialog } from '../common/Dialog'
import { Spinner } from '../common/Spinner'
import { AgentCard } from './AgentCard'

export function AgentBrowser() {
  const { registry, registryLoading, registryError, fetchRegistry, loadInstalled } = useAgentStore()
  const { registryBrowserOpen, setRegistryBrowserOpen } = useUiStore()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (registryBrowserOpen) {
      fetchRegistry()
      loadInstalled()
    }
  }, [registryBrowserOpen])

  const filteredAgents = (registry?.agents || []).filter(
    (agent) =>
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.description.toLowerCase().includes(search.toLowerCase()) ||
      agent.id.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Dialog
      open={registryBrowserOpen}
      onClose={() => setRegistryBrowserOpen(false)}
      title="ACP Agent Registry"
      className="w-[700px] max-h-[80vh]"
    >
      <div className="space-y-4">
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
    </Dialog>
  )
}
