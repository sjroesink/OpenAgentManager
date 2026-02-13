import { useEffect } from 'react'
import type { IpcEvents } from '@shared/types/ipc'
import { on } from '../lib/ipc-client'

/**
 * Subscribe to an IPC event channel with automatic cleanup
 */
export function useIpcEvent<T extends keyof IpcEvents>(
  channel: T,
  callback: (data: IpcEvents[T]) => void
): void {
  useEffect(() => {
    const unsubscribe = on(channel, callback)
    return unsubscribe
  }, [channel, callback])
}
