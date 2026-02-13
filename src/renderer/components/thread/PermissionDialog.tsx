import React from 'react'
import { useSessionStore } from '../../stores/session-store'
import { Dialog } from '../common/Dialog'
import { Button } from '../common/Button'

export function PermissionDialog() {
  const { pendingPermissions, respondToPermission } = useSessionStore()

  const currentPermission = pendingPermissions[0]
  if (!currentPermission) return null

  return (
    <Dialog
      open={true}
      onClose={() => respondToPermission(currentPermission.requestId, false)}
      title="Permission Required"
      className="max-w-md"
    >
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">
            {currentPermission.title}
          </h3>
          <p className="text-sm text-text-secondary">
            {currentPermission.description}
          </p>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => respondToPermission(currentPermission.requestId, false)}
          >
            Deny
          </Button>
          {currentPermission.allowAlways && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => respondToPermission(currentPermission.requestId, true, true)}
            >
              Allow Always
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => respondToPermission(currentPermission.requestId, true)}
          >
            Allow
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
