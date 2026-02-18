import { useEffect, useState } from 'react'
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

  const iconUrl = getAgentIconUrl(agentId, icon)
  const isTrustedRegistryIcon =
    typeof iconUrl === 'string' &&
    iconUrl.startsWith(ACP_CDN_URL)

  useEffect(() => {
    setInlineSvgError(false)
  }, [iconUrl])

  useEffect(() => {
    if (!isTrustedRegistryIcon || !iconUrl) {
      setInlineSvg(null)
      return
    }

    let cancelled = false

    void window.api
      .invoke('registry:get-icon-svg', { agentId, icon })
      .then((svgText) => {
        if (!svgText) {
          throw new Error('No SVG icon returned')
        }

        if (cancelled || !svgText.includes('<svg')) return
        const sanitizedSvg = svgText
          .replace(/<\?xml[\s\S]*?\?>/gi, '')
          .replace(/<!doctype[\s\S]*?>/gi, '')
          .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
          .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, '')
          .replace(/\sfill\s*=\s*(["'])(?!none\1|currentColor\1|url\(#).*?\1/gi, ' fill="currentColor"')
          .replace(/\sstroke\s*=\s*(["'])(?!none\1|currentColor\1|url\(#).*?\1/gi, ' stroke="currentColor"')
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
  }, [agentId, icon, iconUrl, isTrustedRegistryIcon])

  if (inlineSvg) {
    return (
      <span
        className={`${sizeClasses[size]} agent-icon-inline rounded shrink-0 text-white [&_svg]:w-full [&_svg]:h-full [&_svg]:block [&_svg]:text-current ${className}`}
        role="img"
        aria-label={name}
        dangerouslySetInnerHTML={{ __html: inlineSvg }}
      />
    )
  }

  if (isTrustedRegistryIcon && (inlineSvgError || !inlineSvg)) {
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

  const showImage = iconUrl

  if (showImage) {
    return (
      <span
        role="img"
        aria-label={name}
        className={`${sizeClasses[size]} rounded shrink-0 bg-current text-white ${className}`}
        style={{
          WebkitMaskImage: `url("${iconUrl}")`,
          maskImage: `url("${iconUrl}")`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
          WebkitMaskSize: 'contain',
          maskSize: 'contain'
        }}
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
