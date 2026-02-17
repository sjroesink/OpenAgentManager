import { useEffect, useMemo } from 'react'
import { useAgentStore } from '@renderer/stores/agent-store'

interface ModelPickerProps {
  agentId: string | null
  projectPath: string
  value: string | null | undefined
  onChange: (modelId: string | null) => void
  emptyLabel?: string
  className?: string
  showLabel?: boolean
}

export function ModelPicker({
  agentId,
  projectPath,
  value,
  onChange,
  emptyLabel = 'Default model',
  className,
  showLabel = true
}: ModelPickerProps) {
  const loadAgentModels = useAgentStore((s) => s.loadAgentModels)
  const modelsByAgent = useAgentStore((s) => s.modelsByAgent)
  const modelsLoadingByAgent = useAgentStore((s) => s.modelsLoadingByAgent)

  useEffect(() => {
    if (!agentId || !projectPath) return
    loadAgentModels(agentId, projectPath).catch((error) => {
      console.error(`Failed to load models for ${agentId}:`, error)
    })
  }, [agentId, projectPath, loadAgentModels])

  const catalog = agentId ? modelsByAgent[agentId] : undefined
  const isLoading = agentId ? modelsLoadingByAgent[agentId] === true : false
  const options = useMemo(() => catalog?.availableModels || [], [catalog])

  if (!agentId) return null
  if (!isLoading && options.length === 0) return null

  return (
    <div>
      {showLabel && (
        <label className="block text-xs font-medium text-text-secondary mb-1.5">
          Model
        </label>
      )}
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={isLoading}
        className={
          className ||
          'w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60'
        }
      >
        <option value="">{isLoading ? 'Loading models...' : emptyLabel}</option>
        {options.map((model) => (
          <option key={model.modelId} value={model.modelId}>
            {model.name}
          </option>
        ))}
      </select>
    </div>
  )
}
