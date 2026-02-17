import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { useAcpFeaturesStore } from '../../stores/acp-features-store'
import { Button } from '../common/Button'
import type { SlashCommand, ContentBlock, ImageContent, ConfigOption } from '@shared/types/session'

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

export function PromptInput() {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<ImageContent[]>([])
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [commandQuery, setCommandQuery] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const commandMenuRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { activeSessionId, sendPrompt, getActiveSession } = useSessionStore()
  const { getSessionState, setConfigOption } = useAcpFeaturesStore()

  const session = getActiveSession()
  const isInitializing = session?.status === 'initializing'
  const isCreating = session?.status === 'creating'
  const isPrompting = session?.status === 'prompting'
  const isBusy = isCreating || isInitializing
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

  const handleSubmit = useCallback(async () => {
    if (!text.trim() && attachments.length === 0) return
    if (!activeSessionId || isBusy) return

    const content: ContentBlock[] = []

    if (text.trim()) {
      content.push({ type: 'text', text: text.trim() })
    }

    content.push(...attachments)

    setText('')
    setAttachments([])

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    await sendPrompt(content)
  }, [text, attachments, activeSessionId, isBusy, sendPrompt])

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
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`

    // Slash command detection
    const textBeforeCursor = newText.slice(0, textarea.selectionStart)
    if (textBeforeCursor.startsWith('/') && !textBeforeCursor.includes(' ') && availableCommands.length > 0) {
      setCommandQuery(textBeforeCursor.slice(1))
      setCommandMenuOpen(true)
      setSelectedCommandIndex(0)
    } else {
      setCommandMenuOpen(false)
    }
  }

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
  }, [])

  if (!activeSessionId) return null

  const canSubmit = (text.trim() || attachments.length > 0) && !isBusy

  return (
    <div
      ref={containerRef}
      className={`border-t border-border p-3 bg-surface-0 shrink-0 ${isDragging ? 'bg-accent/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex items-center gap-2 mb-2 max-w-3xl mx-auto flex-wrap">
          {attachments.map((attachment, index) => (
            <div key={index} className="relative group">
              <img
                src={`data:${attachment.mimeType};base64,${attachment.data}`}
                alt={`Attachment ${index + 1}`}
                className="w-16 h-16 object-cover rounded-lg border border-border"
              />
              <button
                onClick={() => removeAttachment(index)}
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

      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <div className="flex-1 relative">
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
            value={isCreating && session?.pendingPrompt ? session.pendingPrompt : text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isInitializing ? 'Launching agent...' : isCreating ? 'Setting up session...' : isPrompting ? 'Agent is working. Queue your next message...' : 'Send a message... (Enter to send, Shift+Enter for new line, Ctrl+V to paste images)'}
            disabled={isBusy}
            readOnly={isInitializing || isCreating}
            rows={1}
            className="w-full bg-surface-1 border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-colors disabled:opacity-50"
            style={{ minHeight: '40px', maxHeight: '200px' }}
          />
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="shrink-0 rounded-xl h-[40px] w-[40px] !p-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </Button>
      </div>

      {/* Bottom bar: config selectors */}
      <div className="flex items-center gap-1 max-w-3xl mx-auto mt-1.5">
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
    </div>
  )
}
