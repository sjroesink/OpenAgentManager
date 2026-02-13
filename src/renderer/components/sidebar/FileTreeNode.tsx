import React, { useState } from 'react'
import type { FileTreeNode as FileTreeNodeType } from '@shared/types/project'

interface FileTreeNodeProps {
  node: FileTreeNodeType
  depth: number
}

const FILE_ICONS: Record<string, string> = {
  ts: '🔷',
  tsx: '🔷',
  js: '🟡',
  jsx: '🟡',
  json: '📋',
  md: '📝',
  css: '🎨',
  html: '🌐',
  py: '🐍',
  rs: '🦀',
  go: '🔵',
  yaml: '⚙️',
  yml: '⚙️',
  toml: '⚙️',
  lock: '🔒',
  gitignore: '📁'
}

export function FileTreeNode({ node, depth }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1)

  const isDir = node.type === 'directory'
  const icon = isDir
    ? expanded
      ? '📂'
      : '📁'
    : FILE_ICONS[node.extension || ''] || '📄'

  return (
    <div>
      <button
        onClick={() => isDir && setExpanded(!expanded)}
        className="w-full flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-surface-2 transition-colors text-text-secondary hover:text-text-primary"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir && (
          <svg
            className={`w-3 h-3 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
        {!isDir && <span className="w-3 shrink-0" />}
        <span className="text-[11px] shrink-0">{icon}</span>
        <span className="truncate">{node.name}</span>
      </button>

      {isDir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
