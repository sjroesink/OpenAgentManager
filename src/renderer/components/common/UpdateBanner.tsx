import React, { useState, useEffect, useCallback } from 'react'
import { useIpcEvent } from '../../hooks/useIpc'

type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  const onAvailable = useCallback(
    (data: { version: string; releaseNotes?: string }) => {
      setState({ status: 'available', version: data.version })
      setDismissed(false)
    },
    []
  )

  const onProgress = useCallback(
    (data: { percent: number }) => {
      setState((prev) =>
        prev.status === 'downloading' || prev.status === 'available'
          ? { status: 'downloading', percent: data.percent }
          : prev
      )
    },
    []
  )

  const onDownloaded = useCallback(
    (data: { version: string }) => {
      setState({ status: 'downloaded', version: data.version })
      setDismissed(false)
    },
    []
  )

  const onError = useCallback(
    (data: { message: string }) => {
      setState({ status: 'error', message: data.message })
    },
    []
  )

  useIpcEvent('updater:update-available', onAvailable)
  useIpcEvent('updater:download-progress', onProgress)
  useIpcEvent('updater:update-downloaded', onDownloaded)
  useIpcEvent('updater:error', onError)

  if (dismissed || state.status === 'idle' || state.status === 'error') {
    return null
  }

  const handleDownload = () => {
    setState({ status: 'downloading', percent: 0 })
    window.api.invoke('updater:download', undefined)
  }

  const handleInstall = () => {
    window.api.invoke('updater:install', undefined)
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-accent/10 border-b border-accent/20 text-sm">
      <svg className="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>

      {state.status === 'available' && (
        <>
          <span className="text-text-primary">
            Update <span className="font-medium">v{state.version}</span> is available.
          </span>
          <button
            onClick={handleDownload}
            className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
          >
            Download
          </button>
        </>
      )}

      {state.status === 'downloading' && (
        <>
          <span className="text-text-primary flex-1">
            Downloading update... {Math.round(state.percent)}%
          </span>
          <div className="w-32 h-1.5 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        </>
      )}

      {state.status === 'downloaded' && (
        <>
          <span className="text-text-primary">
            Update <span className="font-medium">v{state.version}</span> is ready to install.
          </span>
          <button
            onClick={handleInstall}
            className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
          >
            Restart & Install
          </button>
        </>
      )}

      <button
        onClick={() => setDismissed(true)}
        className="ml-auto p-0.5 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors shrink-0"
        title="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
