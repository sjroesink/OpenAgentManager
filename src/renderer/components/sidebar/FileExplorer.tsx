import React, { useEffect } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { FileTreeNode as FileTreeNodeComponent } from './FileTreeNode'
import { Spinner } from '../common/Spinner'

export function FileExplorer() {
  const { project, fileTree, fileTreeLoading, loadFileTree } = useProjectStore()

  useEffect(() => {
    if (project && fileTree.length === 0) {
      loadFileTree()
    }
  }, [project, fileTree.length, loadFileTree])

  if (!project) {
    return (
      <div className="p-4 text-center text-xs text-text-muted">
        Open a project to browse files.
      </div>
    )
  }

  if (fileTreeLoading) {
    return (
      <div className="p-4 flex justify-center">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div className="py-1">
      {fileTree.map((node) => (
        <FileTreeNodeComponent key={node.path} node={node} depth={0} />
      ))}
    </div>
  )
}
