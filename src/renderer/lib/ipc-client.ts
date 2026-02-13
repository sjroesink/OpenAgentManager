import type { IpcChannels, IpcEvents } from '@shared/types/ipc'

/**
 * Typed wrapper around window.api for use in React components
 */
export function invoke<T extends keyof IpcChannels>(
  channel: T,
  data: IpcChannels[T]['request']
): Promise<IpcChannels[T]['response']> {
  return window.api.invoke(channel, data)
}

export function on<T extends keyof IpcEvents>(
  channel: T,
  callback: (data: IpcEvents[T]) => void
): () => void {
  return window.api.on(channel, callback)
}
