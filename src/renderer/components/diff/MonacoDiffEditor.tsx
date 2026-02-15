import React, { useRef, useEffect, useMemo } from 'react'
import { monaco } from '../../lib/monaco-setup'

interface MonacoDiffEditorProps {
  originalContent: string
  modifiedContent: string
  filePath: string
  sideBySide?: boolean
}

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  r: 'r',
  lua: 'lua'
}

export function MonacoDiffEditor({
  originalContent,
  modifiedContent,
  filePath,
  sideBySide = true
}: MonacoDiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  const language = useMemo(() => {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    return LANG_MAP[ext] || 'plaintext'
  }, [filePath])

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return

    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: 'agent-manager-dark',
      readOnly: true,
      renderSideBySide: sideBySide,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      lineNumbers: 'on',
      renderOverviewRuler: false,
      hideUnchangedRegions: {
        enabled: true,
        revealLineCount: 3,
        minimumLineCount: 5,
        contextLineCount: 3
      },
      glyphMargin: false,
      folding: false,
      renderLineHighlight: 'none',
      selectionHighlight: false,
      occurrencesHighlight: 'off' as unknown as undefined,
      scrollbar: {
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        useShadows: false
      },
      padding: { top: 8, bottom: 8 }
    })

    editorRef.current = editor

    return () => {
      editor.dispose()
    }
  }, [])

  // Update side-by-side mode
  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  // Update models when content or language changes
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const originalUri = monaco.Uri.parse(`original:///${filePath}`)
    const modifiedUri = monaco.Uri.parse(`modified:///${filePath}`)

    // Dispose old models if they exist
    const existingOriginal = monaco.editor.getModel(originalUri)
    const existingModified = monaco.editor.getModel(modifiedUri)
    existingOriginal?.dispose()
    existingModified?.dispose()

    const originalModel = monaco.editor.createModel(originalContent, language, originalUri)
    const modifiedModel = monaco.editor.createModel(modifiedContent, language, modifiedUri)

    editor.setModel({ original: originalModel, modified: modifiedModel })

    return () => {
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [originalContent, modifiedContent, filePath, language])

  return <div ref={containerRef} className="h-full w-full" />
}
