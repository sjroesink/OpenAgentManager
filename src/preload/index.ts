import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannels, IpcEvents, ElectronAPI } from '@shared/types/ipc'

const api: ElectronAPI = {
  invoke<T extends keyof IpcChannels>(
    channel: T,
    data: IpcChannels[T]['request']
  ): Promise<IpcChannels[T]['response']> {
    return ipcRenderer.invoke(channel, data)
  },

  on<T extends keyof IpcEvents>(
    channel: T,
    callback: (data: IpcEvents[T]) => void
  ): () => void {
    const handler = (_event: Electron.IpcRendererEvent, data: IpcEvents[T]) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  off<T extends keyof IpcEvents>(
    channel: T,
    callback: (data: IpcEvents[T]) => void
  ): void {
    ipcRenderer.removeListener(channel, callback as (...args: unknown[]) => void)
  }
}

contextBridge.exposeInMainWorld('api', api)
