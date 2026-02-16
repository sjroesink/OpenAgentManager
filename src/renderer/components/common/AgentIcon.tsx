import React, { useEffect, useState } from 'react'
import { ACP_CDN_URL, getAgentIconUrl } from '@shared/constants'

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
  const [inlineSvg, setInlineSvg] = useState<string | null>(null)
  const [inlineSvgError, setInlineSvgError] = useState(false)
  const [imgError, setImgError] = useState(false)

  const iconUrl = getAgentIconUrl(agentId, icon)
  const isTrustedSvg =
    typeof iconUrl === 'string' &&
    iconUrl.startsWith(ACP_CDN_URL) &&
    iconUrl.toLowerCase().endsWith('.svg')
  const canInlineSvg = isTrustedSvg && !inlineSvgError && !imgError

  useEffect(() => {
    setInlineSvgError(false)
    setImgError(false)
  }, [iconUrl])

  useEffect(() => {
    if (!canInlineSvg || !iconUrl) {
      setInlineSvg(null)
      return
    }

    let cancelled = false

    void fetch(iconUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch icon: ${response.status}`)
        }
        return response.text()
      })
      .then((svgText) => {
        if (cancelled || !svgText.includes('<svg')) return
        const sanitizedSvg = svgText
          .replace(/<\?xml[\s\S]*?\?>/gi, '')
          .replace(/<!doctype[\s\S]*?>/gi, '')
        setInlineSvg(sanitizedSvg)
      })
      .catch(() => {
        if (!cancelled) {
          setInlineSvgError(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [canInlineSvg, iconUrl])

  if (inlineSvg) {
    return (
      <span
        className={`${sizeClasses[size]} rounded bg-surface-2 shrink-0 [&_svg]:w-full [&_svg]:h-full [&_svg]:block ${className}`}
        role="img"
        aria-label={name}
        dangerouslySetInnerHTML={{ __html: inlineSvg }}
      />
    )
  }

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
