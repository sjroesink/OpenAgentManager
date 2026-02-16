import React, { useState } from 'react'
import { getAgentIconUrl } from '@shared/constants'

interface AgentIconProps {
  agentId: string
  icon?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'w-4 h-4 text-[10px]',
  md: 'w-6 h-6 text-xs',
  lg: 'w-8 h-8 text-sm'
}

export function AgentIcon({ agentId, icon, name, size = 'md', className = '' }: AgentIconProps) {
  const [imgError, setImgError] = useState(false)

  const iconUrl = getAgentIconUrl(agentId, icon)
  const showImage = iconUrl && !imgError

  if (showImage) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className={`${sizeClasses[size]} rounded object-contain bg-surface-2 ${className}`}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <span
      className={`
        ${sizeClasses[size]} rounded bg-accent/20 flex items-center justify-center 
        font-bold text-accent shrink-0 ${className}
      `}
    >
      {name[0]}
    </span>
  )
}
