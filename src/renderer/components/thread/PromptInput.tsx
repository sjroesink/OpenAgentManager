import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useAcpFeaturesStore } from '../../stores/acp-features-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useRouteStore } from '../../stores/route-store'
import { Button } from '../common/Button'
import type { SlashCommand, ContentBlock, ImageContent, ConfigOption } from '@shared/types/session'

const COMMIT_ALL_PROMPT =
  'Commit all current changes in this workspace. Stage everything and create an appropriate commit message.'
const MIN_TEXTAREA_HEIGHT = 42
const MAX_TEXTAREA_HEIGHT = 200

/** Generic config option dropdown used for mode, model, and other selectors */
function ConfigOptionSelector({
  configOption,
  onSelect,
  disabled
}: {
  configOption: ConfigOption
  onSelect: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const currentOption = configOption.options.find((o) => o.value === configOption.currentValue)
  const currentLabel = currentOption?.name || configOption.currentValue

  const isSearchable = configOption.options.length > 6

  const filteredOptions = useMemo(() => {
    if (!searchQuery) return configOption.options
    const q = searchQuery.toLowerCase()
    return configOption.options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    )
  }, [configOption.options, searchQuery])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    if (open && isSearchable) {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open, isSearchable])

  const handleSelect = (value: string) => {
    onSelect(value)
    setOpen(false)
    setSearchQuery('')
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-1 rounded-md transition-colors disabled:opacity-50"
      >
        <span className="truncate max-w-[200px]">{currentLabel}</span>
        <svg className={`w-3 h-3 opacity-60 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-0 mb-1 min-w-[200px] max-w-[350px] bg-surface-2 border border-border rounded-lg shadow-lg py-1 z-50 max-h-80 flex flex-col"
        >
          {isSearchable && (
            <div className="px-2 py-1.5 border-b border-border">
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${configOption.name.toLowerCase()}...`}
                className="w-full bg-surface-1 border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50"
              />
            </div>
          )}
          <div className="overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-muted">No matches</div>
            ) : (
              filteredOptions.map((option) => {
                const isActive = option.value === configOption.currentValue
                return (
                  <button
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-surface-3 transition-colors ${
                      isActive ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{option.name}</div>
                      {option.description && (
                        <div className="text-xs text-text-muted truncate">{option.description}</div>
                      )}
                    </div>
                    {isActive && (
                      <svg className="w-4 h-4 text-accent shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface PromptInputProps {
  mode?: 'session' | 'draft'
  onDraftSubmit?: (content: ContentBlock[]) => Promise<void> | void
  draftDisabled?: boolean
  draftCanSubmit?: boolean
  draftPlaceholder?: string
}

export function PromptInput({
  mode = 'session',
  onDraftSubmit,
  draftDisabled = false,
  draftCanSubmit = true,
  draftPlaceholder = 'Start your first message... (Enter to create thread, Shift+Enter for new line, Ctrl+V to paste images)'
}: PromptInputProps = {}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<ImageContent[]>([])
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [commandQuery, setCommandQuery] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [diffTotals, setDiffTotals] = useState({ additions: 0, deletions: 0, fileCount: 0 })
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<string | null>(null)
  const [isEditingBranch, setIsEditingBranch] = useState(false)
  const [branchInput, setBranchInput] = useState('')
  const [isRenamingBranch, setIsRenamingBranch] = useState(false)
  const [branchRenameError, setBranchRenameError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const commandMenuRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    activeSessionId,
    activeDraftId,
    sendPrompt,
    getActiveSession,
    renameWorktreeBranch,
    getComposerDraft,
    setComposerDraft,
    clearComposerDraft
  } = useSessionStore()
  const { getSessionState, setConfigOption } = useAcpFeaturesStore()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const navigate = useRouteStore((s) => s.navigate)
  const currentRoute = useRouteStore((s) => s.current.route)
  const composerDraftId = mode === 'session' ? activeSessionId : activeDraftId

  const session = getActiveSession()
  const isInitializing = mode === 'session' && session?.status === 'initializing'
  const isCreating = mode === 'session' && session?.status === 'creating'
  const isPrompting = mode === 'session' && session?.status === 'prompting'
  const isBusy = mode === 'draft' ? draftDisabled : false
  const isModeChangeDisabled = isInitializing || isCreating

  // ACP state for the active session
  const acpState = activeSessionId ? getSessionState(activeSessionId) : undefined
  const commands = acpState?.commands
  const configOpts = acpState?.configOptions
  const availableCommands = useMemo(() => commands ?? [], [commands])
  const configOptions = useMemo(() => configOpts ?? [], [configOpts])

  // Derive mode and model config options from ACP state
  const modeConfig = useMemo(
    () => configOptions.find((o) => o.category === 'mode'),
    [configOptions]
  )
  const modelConfig = useMemo(
    () => configOptions.find((o) => o.category === 'model'),
    [configOptions]
  )
  // Other config options (not mode or model)
  const otherConfigs = useMemo(
    () => configOptions.filter((o) => o.category !== 'mode' && o.category !== 'model'),
    [configOptions]
  )

  const filteredCommands = useMemo(() => {
    if (!commandQuery) return availableCommands
    const lowerQuery = commandQuery.toLowerCase()
    return availableCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(lowerQuery))
  }, [availableCommands, commandQuery])

  const selectCommand = useCallback((command: SlashCommand) => {
    const commandText = `/${command.name} `
    setText(commandText)
    setCommandMenuOpen(false)
    if (textareaRef.current) {
      textareaRef.current.focus()
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = commandText.length
          textareaRef.current.selectionEnd = commandText.length
        }
      })
    }
  }, [])

  // Close command menu on outside click
  useEffect(() => {
    if (!commandMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (
        commandMenuRef.current && !commandMenuRef.current.contains(e.target as Node) &&
        textareaRef.current && !textareaRef.current.contains(e.target as Node)
      ) {
        setCommandMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [commandMenuOpen])

  useEffect(() => {
    if (previewIndex === null) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewIndex(null)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [previewIndex])

  const handleSubmit = useCallback(async () => {
    if (!text.trim() && attachments.length === 0) return
    if (mode === 'draft' && draftDisabled) return

    const content: ContentBlock[] = []

    content.push(...attachments)

    if (text.trim()) {
      content.push({ type: 'text', text: text.trim() })
    }

    setText('')
    setAttachments([])
    if (composerDraftId) {
      clearComposerDraft(composerDraftId)
    }

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = `${MIN_TEXTAREA_HEIGHT}px`
      textareaRef.current.style.overflowY = 'hidden'
    }

    if (mode === 'draft') {
      await onDraftSubmit?.(content)
      return
    }

    if (!activeSessionId) return
    await sendPrompt(content)
  }, [text, attachments, mode, draftDisabled, onDraftSubmit, activeSessionId, sendPrompt, composerDraftId, clearComposerDraft])

  const adjustTextareaHeight = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto'
    const BORDER_WIDTH = 2
    const nextHeight = Math.min(textarea.scrollHeight + BORDER_WIDTH, MAX_TEXTAREA_HEIGHT)
    textarea.style.height = `${Math.max(nextHeight, MIN_TEXTAREA_HEIGHT)}px`
    textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (commandMenuOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectCommand(filteredCommands[selectedCommandIndex])
        return
      }
    }
    if (commandMenuOpen && e.key === 'Escape') {
      e.preventDefault()
      setCommandMenuOpen(false)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)

    // Auto-resize
    const textarea = e.target
    adjustTextareaHeight(textarea)

    // Slash command detection
    const textBeforeCursor = newText.slice(0, textarea.selectionStart)
    if (
      mode === 'session' &&
      textBeforeCursor.startsWith('/') &&
      !textBeforeCursor.includes(' ') &&
      availableCommands.length > 0
    ) {
      setCommandQuery(textBeforeCursor.slice(1))
      setCommandMenuOpen(true)
      setSelectedCommandIndex(0)
    } else {
      setCommandMenuOpen(false)
    }
  }

  const inputValue = text

  useEffect(() => {
    if (!composerDraftId) {
      setText('')
      setAttachments([])
      return
    }
    const draft = getComposerDraft(composerDraftId)
    setText(draft.text)
    setAttachments(draft.attachments)
  }, [composerDraftId, getComposerDraft])

  useEffect(() => {
    if (!composerDraftId) return
    setComposerDraft(composerDraftId, { text, attachments })
  }, [composerDraftId, text, attachments, setComposerDraft])

  useEffect(() => {
    if (!textareaRef.current) return
    adjustTextareaHeight(textareaRef.current)
  }, [inputValue, adjustTextareaHeight])

  const handleConfigOptionChange = useCallback(
    (configId: string, value: string) => {
      if (!activeSessionId) return
      setConfigOption(activeSessionId, configId, value)
    },
    [activeSessionId, setConfigOption]
  )

  const processFile = useCallback((file: File): Promise<ImageContent | null> => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        resolve(null)
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const base64 = result.split(',')[1]
        resolve({
          type: 'image',
          data: base64,
          mimeType: file.type
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  }, [])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }

    if (imageFiles.length === 0) return

    e.preventDefault()
    const newImages: ImageContent[] = []
    for (const file of imageFiles) {
      const image = await processFile(file)
      if (image) newImages.push(image)
    }
    if (newImages.length > 0) {
      setAttachments((prev) => [...prev, ...newImages])
    }
  }, [processFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))

    if (imageFiles.length === 0) return

    const newImages: ImageContent[] = []
    for (const file of imageFiles) {
      const image = await processFile(file)
      if (image) newImages.push(image)
    }
    if (newImages.length > 0) {
      setAttachments((prev) => [...prev, ...newImages])
    }
  }, [processFile])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
    setPreviewIndex((prev) => {
      if (prev === null) return prev
      if (prev === index) return null
      return prev > index ? prev - 1 : prev
    })
  }, [])

  const hasContent = text.trim() || attachments.length > 0
  const canSubmit = mode === 'draft'
    ? !!hasContent && !isBusy && draftCanSubmit
    : !!hasContent && !isBusy
  const canCommitChanges =
    mode === 'session' &&
    diffTotals.fileCount > 0 &&
    !committing &&
    !isInitializing &&
    !isCreating
  const activeWorkspace = session
    ? workspaces.find((workspace) => workspace.id === session.workspaceId)
    : null
  const sourceBranch = activeWorkspace?.gitBranch || 'main'
  const targetBranch = session?.worktreeBranch || sourceBranch
  const canRenameBranch =
    mode === 'session' &&
    !!session?.sessionId &&
    !!session?.worktreeBranch &&
    session?.useWorktree === true
  const previewAttachment =
    previewIndex !== null && previewIndex >= 0 && previewIndex < attachments.length
      ? attachments[previewIndex]
      : null

  useEffect(() => {
    const workingDir = session?.workingDir
    if (mode !== 'session' || !workingDir) {
      setDiffTotals({ additions: 0, deletions: 0, fileCount: 0 })
      return
    }

    let cancelled = false
    window.api
      .invoke('file:get-changes', { workingDir })
      .then((changes: Array<{ additions: number; deletions: number }>) => {
        if (cancelled) return
        const additions = changes.reduce((sum, change) => sum + change.additions, 0)
        const deletions = changes.reduce((sum, change) => sum + change.deletions, 0)
        setDiffTotals({ additions, deletions, fileCount: changes.length })
      })
      .catch(() => {
        if (!cancelled) {
          setDiffTotals({ additions: 0, deletions: 0, fileCount: 0 })
        }
      })

    return () => {
      cancelled = true
    }
  }, [mode, session?.sessionId, session?.workingDir, session?.status])

  useEffect(() => {
    setBranchInput(session?.worktreeBranch || '')
    setIsEditingBranch(false)
    setBranchRenameError(null)
  }, [session?.sessionId, session?.worktreeBranch])

  const handleCommitChanges = useCallback(async () => {
    if (!canCommitChanges) return
    setCommitting(true)
    setCommitResult(null)
    try {
      await sendPrompt([{ type: 'text', text: COMMIT_ALL_PROMPT }])
      setCommitResult('Commit request sent to agent')
    } catch (error) {
      setCommitResult(
        `Error: ${error instanceof Error ? error.message : 'Failed to send commit request'}`
      )
    } finally {
      setCommitting(false)
    }
  }, [canCommitChanges, sendPrompt])

  const handleRenameBranch = useCallback(async () => {
    if (!session?.sessionId || !canRenameBranch || isRenamingBranch) return
    const nextBranch = branchInput.trim()
    if (!nextBranch) {
      setBranchRenameError('Branch name is required')
      return
    }

    setIsRenamingBranch(true)
    setBranchRenameError(null)
    try {
      await renameWorktreeBranch(session.sessionId, nextBranch)
      setIsEditingBranch(false)
    } catch (error) {
      setBranchRenameError(error instanceof Error ? error.message : 'Failed to rename branch')
    } finally {
      setIsRenamingBranch(false)
    }
  }, [session?.sessionId, canRenameBranch, isRenamingBranch, branchInput, renameWorktreeBranch])

  if (mode === 'session' && !activeSessionId) return null

  return (
    <>
      <div
        ref={containerRef}
        className={`${
          mode === 'session' ? 'border-t border-border p-3 bg-surface-0 shrink-0' : 'p-0 bg-transparent'
        } ${isDragging ? 'bg-accent/5' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex items-center gap-2 mb-2 max-w-3xl mx-auto flex-wrap">
          {attachments.map((attachment, index) => (
            <div key={index} className="relative group">
              <button
                type="button"
                onClick={() => setPreviewIndex(index)}
                className="block"
                title="Preview attachment"
              >
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt={`Attachment ${index + 1}`}
                  className="w-16 h-16 object-cover rounded-lg border border-border cursor-zoom-in"
                />
              </button>
              <button
                onClick={() => removeAttachment(index)}
                type="button"
                aria-label="Remove attachment"
                className="absolute -top-1 -right-1 w-5 h-5 bg-error rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-accent/10 border-2 border-dashed border-accent rounded-lg flex items-center justify-center pointer-events-none z-50">
          <span className="text-accent font-medium">Drop images here</span>
        </div>
      )}

      {mode === 'session' && session && (
        <div className="max-w-3xl mx-auto mb-0">
          <div className="flex items-center gap-2 p-2 rounded-t-xl rounded-b-none bg-surface-1 border border-border border-b-0">
            <div className="flex items-center gap-1.5 text-sm min-w-0 flex-1">
              <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18 10a3 3 0 100-6 3 3 0 000 6zM6 14a3 3 0 100-6 3 3 0 000 6zm12 10a3 3 0 100-6 3 3 0 000 6zM6 8v8a2 2 0 002 2h7"
                />
              </svg>
              <span className="text-text-secondary truncate">{sourceBranch}</span>
              <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 12H7m0 0l4-4m-4 4l4 4" />
              </svg>
              {canRenameBranch && isEditingBranch ? (
                <div className="flex items-center gap-1 min-w-0">
                  <input
                    value={branchInput}
                    onChange={(e) => setBranchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleRenameBranch()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setIsEditingBranch(false)
                        setBranchInput(session?.worktreeBranch || '')
                        setBranchRenameError(null)
                      }
                    }}
                    className="bg-surface-2 border border-border rounded px-2 py-0.5 text-xs text-text-primary w-44 focus:outline-none focus:border-accent/50"
                    disabled={isRenamingBranch}
                    autoFocus
                  />
                  <button
                    onClick={() => void handleRenameBranch()}
                    disabled={isRenamingBranch}
                    className="p-1 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary disabled:opacity-50"
                    title="Save branch name"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingBranch(false)
                      setBranchInput(session?.worktreeBranch || '')
                      setBranchRenameError(null)
                    }}
                    disabled={isRenamingBranch}
                    className="p-1 rounded hover:bg-surface-2 text-text-secondary hover:text-text-primary disabled:opacity-50"
                    title="Cancel rename"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-text-primary font-medium truncate">{targetBranch}</span>
                  {canRenameBranch && (
                    <button
                      onClick={() => {
                        setIsEditingBranch(true)
                        setBranchInput(session?.worktreeBranch || '')
                        setBranchRenameError(null)
                      }}
                      className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary"
                      title="Rename worktree branch"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5h2m-1-1v2m-6 8l8-8 3 3-8 8H6v-3z" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => navigate('diff')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
                currentRoute === 'diff'
                  ? 'border-accent/40 bg-accent/20 text-accent'
                  : 'border-border text-text-secondary hover:text-text-primary hover:bg-surface-2'
              }`}
              title="Open full diff view (Ctrl+Shift+D)"
            >
              <span className="font-mono text-sm text-success">+{diffTotals.additions}</span>
              <span className="font-mono text-sm text-error">-{diffTotals.deletions}</span>
            </button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleCommitChanges}
              disabled={!canCommitChanges}
              className="whitespace-nowrap"
            >
              {committing ? 'Sending...' : 'Commit changes'}
            </Button>
          </div>
          {commitResult && (
            <div
              className={`text-[11px] mt-1 px-1 ${
                commitResult.startsWith('Error') ? 'text-error' : 'text-success'
              }`}
            >
              {commitResult}
            </div>
          )}
          {branchRenameError && (
            <div className="text-[11px] mt-1 px-1 text-error">
              {branchRenameError}
            </div>
          )}
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        <div
          className={`relative border border-border bg-surface-1 px-3 pt-2 pb-2 ${
            mode === 'session' && session
              ? 'rounded-b-2xl rounded-t-none'
              : 'rounded-2xl'
          }`}
        >
          <div className="relative pr-10">
            {/* Slash command autocomplete menu */}
            {commandMenuOpen && (
              <div
                ref={commandMenuRef}
                className="absolute bottom-full left-0 mb-1 w-80 bg-surface-2 border border-border rounded-lg shadow-lg py-1 z-50 max-h-64 overflow-y-auto"
              >
                {filteredCommands.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-text-muted">No matching commands</div>
                ) : (
                  filteredCommands.map((command, index) => (
                    <button
                      key={command.name}
                      onClick={() => selectCommand(command)}
                      onMouseEnter={() => setSelectedCommandIndex(index)}
                      className={`w-full flex flex-col gap-0.5 px-3 py-2 text-left transition-colors ${
                        index === selectedCommandIndex ? 'bg-surface-3' : 'hover:bg-surface-3'
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-accent">/{command.name}</span>
                        {command.input?.hint && (
                          <span className="text-xs text-text-muted italic">{command.input.hint}</span>
                        )}
                      </div>
                      <div className="text-xs text-text-secondary">{command.description}</div>
                    </button>
                  ))
                )}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                mode === 'draft'
                  ? draftPlaceholder
                  : isInitializing
                    ? 'Launching agent... (messages will queue)'
                    : isCreating
                      ? 'Setting up session... (messages will queue)'
                      : isPrompting
                        ? 'Agent is working. Queue your next message...'
                        : 'Send a message... (Enter to send, Shift+Enter for new line, Ctrl+V to paste images)'
              }
              disabled={mode === 'draft' && draftDisabled}
              rows={1}
              className="w-full box-border bg-transparent border-0 rounded-xl px-1.5 py-1 text-sm text-text-primary placeholder-text-muted resize-none overflow-y-hidden focus:outline-none disabled:opacity-50"
              style={{ minHeight: `${MIN_TEXTAREA_HEIGHT}px`, maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }}
            />
          </div>

          <div className="mt-1 min-h-7 pr-10">
            {mode === 'session' && (
              <div className="flex items-center gap-1 flex-wrap">
                {/* Mode selector: only when provided by ACP */}
                {modeConfig && (
                  <ConfigOptionSelector
                    configOption={modeConfig}
                    onSelect={(value) => handleConfigOptionChange(modeConfig.id, value)}
                    disabled={isModeChangeDisabled}
                  />
                )}

                {/* Model selector (if agent provides models) */}
                {modelConfig && (
                  <ConfigOptionSelector
                    configOption={modelConfig}
                    onSelect={(value) => handleConfigOptionChange(modelConfig.id, value)}
                    disabled={isInitializing || isCreating}
                  />
                )}

                {/* Other config option selectors */}
                {otherConfigs.map((config) => (
                  <ConfigOptionSelector
                    key={config.id}
                    configOption={config}
                    onSelect={(value) => handleConfigOptionChange(config.id, value)}
                    disabled={isInitializing || isCreating}
                  />
                ))}
              </div>
            )}
          </div>

          <Button
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="absolute bottom-2 right-2 shrink-0 rounded-lg h-8 w-8 !p-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </Button>
        </div>
      </div>
      </div>

      {previewAttachment && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setPreviewIndex(null)}
        >
          <div className="relative max-w-[95vw] max-h-[95vh]" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewIndex(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white"
              aria-label="Close preview"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={`data:${previewAttachment.mimeType};base64,${previewAttachment.data}`}
              alt="Attachment preview"
              className="max-w-[95vw] max-h-[90vh] rounded-lg border border-border shadow-2xl"
            />
          </div>
        </div>
      )}
    </>
  )
}
