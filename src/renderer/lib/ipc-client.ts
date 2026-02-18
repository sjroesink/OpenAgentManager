import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { IpcChannels, IpcEvents } from '@shared/types/ipc'

// Map IPC channel names (e.g. "registry:fetch") to Tauri command names ("registry_fetch")
function channelToCommand(channel: string): string {
  return channel.replace(/:/g, '_').replace(/-/g, '_')
}

/**
 * Typed invoke wrapper — maps Electron-style IPC channels to Tauri commands.
 */
export function invoke<T extends keyof IpcChannels>(
  channel: T,
  data: IpcChannels[T]['request']
): Promise<IpcChannels[T]['response']> {
  const command = channelToCommand(channel)

  if (data === undefined || data === null) {
    return tauriInvoke(command)
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    return tauriInvoke(command, data as Record<string, unknown>)
  }

  return tauriInvoke(command, { payload: data })
}

/**
 * Subscribe to a Tauri event (replaces Electron's ipcRenderer.on).
 * Returns an unsubscribe function.
 */
export function on<T extends keyof IpcEvents>(
  channel: T,
  callback: (data: IpcEvents[T]) => void
): () => void {
  let unlisten: (() => void) | null = null

  listen<IpcEvents[T]>(channel, (event) => {
    callback(event.payload)
  }).then((fn) => {
    unlisten = fn
  })

  return () => {
    if (unlisten) unlisten()
  }
}
