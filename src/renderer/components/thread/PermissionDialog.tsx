import React, { useState } from 'react'
import { useSessionStore } from '../../stores/session-store'
import { Dialog } from '../common/Dialog'
import { Button } from '../common/Button'
import type { PermissionOption } from '@shared/types/session'

function formatToolTitle(toolCall: { title?: string; rawInput?: unknown }): string {
  // Try to get a clean tool name from the title
  if (toolCall.title) return toolCall.title
  return 'Tool Call'
}

function formatToolDetails(rawInput: unknown): string | null {
  if (!rawInput || typeof rawInput !== 'object') return null
  const input = rawInput as Record<string, unknown>

  // Show file path if present (common for Write/Edit/Read tools)
  const filePath = input.file_path || input.filePath || input.path
  if (typeof filePath === 'string') return filePath

  // Show command if present (Bash tool)
  const command = input.command
  if (typeof command === 'string') return command

  return null
}

export function PermissionDialog() {
  const { pendingPermissions, sessions, respondToPermission } = useSessionStore()
  const [scopePickerFor, setScopePickerFor] = useState<PermissionOption | null>(null)

  const currentPermission = pendingPermissions.find((permission) => {
    const toolCallId = permission.toolCall.toolCallId
    if (!toolCallId) return true

    const session = sessions.find((s) => s.sessionId === permission.sessionId)
    if (!session) return true

    return !session.messages.some((message) =>
      message.toolCalls?.some((toolCall) => toolCall.toolCallId === toolCallId)
    )
  })

  if (!currentPermission) return null

  const safeToolCall = currentPermission.toolCall
  const safeOptions = currentPermission.options
  const title = formatToolTitle(safeToolCall)
  const details = formatToolDetails(safeToolCall.rawInput)

  // Split options into allow (positive) and reject (negative) groups
  const rejectOptions = safeOptions.filter((o) => o.kind.startsWith('reject'))
  const allowOptions = safeOptions.filter((o) => o.kind.startsWith('allow'))

  // Look up the session to get workspaceId for rule saving
  const session = sessions.find((s) => s.sessionId === currentPermission.sessionId)

  const handleOptionClick = (opt: PermissionOption) => {
    if (opt.kind === 'allow_always' || opt.kind === 'reject_always') {
      // Show scope picker for "always" options
      setScopePickerFor(opt)
    } else {
      // "Once" options — respond immediately, no rule saved
      respondToPermission(currentPermission.requestId, opt.optionId)
    }
  }

  const handleScopeSelect = async (scope: 'thread' | 'workspace') => {
    if (!scopePickerFor) return

    const matchKey = safeToolCall.kind || safeToolCall.title || ''

    // Save the permission rule
    if (matchKey && session) {
      try {
        await window.api.invoke('permission:save-rule', {
          optionId: scopePickerFor.optionId,
          ruleKind: scopePickerFor.kind as 'allow_always' | 'reject_always',
          matchKey,
          scope,
          threadId: scope === 'thread' ? currentPermission.sessionId : undefined,
          workspaceId: session.workspaceId
        })
      } catch (err) {
        console.error('[PermissionDialog] Failed to save permission rule:', err)
      }
    }

    // Respond to the current permission request
    respondToPermission(currentPermission.requestId, scopePickerFor.optionId)
    setScopePickerFor(null)
  }

  return (
    <Dialog
      open={true}
      onClose={() => {
        setScopePickerFor(null)
        const rejectOpt = rejectOptions[0] || safeOptions[0]
        respondToPermission(currentPermission.requestId, rejectOpt.optionId)
      }}
      title="Permission Required"
      className="max-w-md"
    >
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">
            {title}
          </h3>
          {details && (
            <p className="text-xs text-text-secondary font-mono bg-surface-0 rounded px-2 py-1.5 break-all">
              {details}
            </p>
          )}
        </div>

        {scopePickerFor ? (
          <div className="space-y-2">
            <p className="text-xs text-text-secondary">
              Apply &quot;{scopePickerFor.name}&quot; to:
            </p>
            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setScopePickerFor(null)}
              >
                Back
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleScopeSelect('thread')}
              >
                This thread
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleScopeSelect('workspace')}
              >
                This workspace
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-end">
            {rejectOptions.map((opt) => (
              <Button
                key={opt.optionId}
                variant="ghost"
                size="sm"
                onClick={() => handleOptionClick(opt)}
              >
                {opt.name}
              </Button>
            ))}
            {allowOptions.map((opt) => (
              <Button
                key={opt.optionId}
                variant={opt.kind === 'allow_always' ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => handleOptionClick(opt)}
              >
                {opt.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}
