import React, { useState, useMemo } from 'react'
import type { FileChange } from '@shared/types/project'

interface DiffFileTreeProps {
  changes: FileChange[]
  selectedFile: string | null
  onSelectFile: (path: string) => void
}

interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  change?: FileChange
}

function buildTree(changes: FileChange[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() }

  for (const change of changes) {
    const parts = change.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const partPath = parts.slice(0, i + 1).join('/')

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: partPath,
          children: new Map(),
          change: isFile ? change : undefined
        })
      } else if (isFile) {
        current.children.get(part)!.change = change
      }

      current = current.children.get(part)!
    }
  }

  return root
}

/** Collapse single-child directory chains (e.g., src/main/services → "src/main/services") */
function collapseTree(node: TreeNode): TreeNode {
  if (node.change) return node // leaf file node

  const children = new Map<string, TreeNode>()
  for (const [, child] of node.children) {
    const collapsed = collapseTree(child)
    // If this is a directory with exactly one child directory (no file), merge names
    if (!collapsed.change && collapsed.children.size === 1) {
      const [grandchildName, grandchild] = [...collapsed.children.entries()][0]
      if (!grandchild.change) {
        const merged: TreeNode = {
          name: `${collapsed.name}/${grandchild.name}`,
          path: grandchild.path,
          children: grandchild.children,
          change: undefined
        }
        children.set(collapsed.name, collapseTree(merged))
        continue
      }
    }
    children.set(collapsed.name, collapsed)
  }

  return { ...node, children }
}

function DirectoryNode({
  node,
  selectedFile,
  onSelectFile,
  depth
}: {
  node: TreeNode
  selectedFile: string | null
  onSelectFile: (path: string) => void
  depth: number
}) {
  const [expanded, setExpanded] = useState(true)

  // Sort: directories first, then files, alphabetical
  const sortedChildren = useMemo(() => {
    return [...node.children.values()].sort((a, b) => {
      const aIsDir = !a.change
      const bIsDir = !b.change
      if (aIsDir && !bIsDir) return -1
      if (!aIsDir && bIsDir) return 1
      return a.name.localeCompare(b.name)
    })
  }, [node.children])

  // Compute directory stats
  const dirStats = useMemo(() => {
    let additions = 0
    let deletions = 0
    function sum(n: TreeNode) {
      if (n.change) {
        additions += n.change.additions
        deletions += n.change.deletions
      }
      for (const [, child] of n.children) sum(child)
    }
    sum(node)
    return { additions, deletions }
  }, [node])

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-surface-2 transition-colors text-left"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <svg
          className={`w-3 h-3 text-text-muted shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span className="truncate text-text-secondary">{node.name}</span>
        <div className="flex-1" />
        {dirStats.additions > 0 && (
          <span className="text-[10px] text-success font-mono">+{dirStats.additions}</span>
        )}
        {dirStats.deletions > 0 && (
          <span className="text-[10px] text-error font-mono ml-1">-{dirStats.deletions}</span>
        )}
      </button>
      {expanded && (
        <div>
          {sortedChildren.map((child) =>
            child.change ? (
              <FileNode
                key={child.path}
                node={child}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                depth={depth + 1}
              />
            ) : (
              <DirectoryNode
                key={child.path}
                node={child}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                depth={depth + 1}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

function FileNode({
  node,
  selectedFile,
  onSelectFile,
  depth
}: {
  node: TreeNode
  selectedFile: string | null
  onSelectFile: (path: string) => void
  depth: number
}) {
  const change = node.change!
  const isSelected = selectedFile === change.path

  return (
    <button
      onClick={() => onSelectFile(change.path)}
      className={`w-full flex items-center gap-1.5 px-2 py-0.5 text-xs transition-colors text-left ${
        isSelected ? 'bg-accent/15 text-text-primary' : 'hover:bg-surface-2 text-text-secondary'
      }`}
      style={{ paddingLeft: (depth + 1) * 12 + 8 }}
    >
      <span className="truncate flex-1">{node.name}</span>
      {change.additions > 0 && (
        <span className="text-[10px] text-success font-mono shrink-0">+{change.additions}</span>
      )}
      {change.deletions > 0 && (
        <span className="text-[10px] text-error font-mono shrink-0 ml-0.5">-{change.deletions}</span>
      )}
    </button>
  )
}

export function DiffFileTree({ changes, selectedFile, onSelectFile }: DiffFileTreeProps) {
  const tree = useMemo(() => collapseTree(buildTree(changes)), [changes])

  const totals = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const c of changes) {
      additions += c.additions
      deletions += c.deletions
    }
    return { additions, deletions }
  }, [changes])

  const sortedChildren = useMemo(() => {
    return [...tree.children.values()].sort((a, b) => {
      const aIsDir = !a.change
      const bIsDir = !b.change
      if (aIsDir && !bIsDir) return -1
      if (!aIsDir && bIsDir) return 1
      return a.name.localeCompare(b.name)
    })
  }, [tree])

  return (
    <div className="h-full flex flex-col bg-surface-1 border-r border-border">
      {/* Summary header */}
      <div className="px-3 py-2 border-b border-border">
        <div className="text-xs text-text-secondary">
          {changes.length} file{changes.length !== 1 ? 's' : ''} changed
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {totals.additions > 0 && (
            <span className="text-xs text-success font-mono">+{totals.additions}</span>
          )}
          {totals.deletions > 0 && (
            <span className="text-xs text-error font-mono">-{totals.deletions}</span>
          )}
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {sortedChildren.map((child) =>
          child.change ? (
            <FileNode
              key={child.path}
              node={child}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              depth={0}
            />
          ) : (
            <DirectoryNode
              key={child.path}
              node={child}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              depth={0}
            />
          )
        )}
      </div>
    </div>
  )
}
