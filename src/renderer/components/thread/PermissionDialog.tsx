import React from 'react'
import { useSessionStore } from '../../stores/session-store'
import { Dialog } from '../common/Dialog'
import { Button } from '../common/Button'

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

  return (
    <Dialog
      open={true}
      onClose={() => {
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

        <div className="flex items-center gap-2 justify-end">
          {rejectOptions.map((opt) => (
            <Button
              key={opt.optionId}
              variant="ghost"
              size="sm"
              onClick={() => respondToPermission(currentPermission.requestId, opt.optionId)}
            >
              {opt.name}
            </Button>
          ))}
          {allowOptions.map((opt) => (
            <Button
              key={opt.optionId}
              variant={opt.kind === 'allow_always' ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => respondToPermission(currentPermission.requestId, opt.optionId)}
            >
              {opt.name}
            </Button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
