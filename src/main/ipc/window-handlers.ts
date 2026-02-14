import { ipcMain, BrowserWindow, app } from 'electron'

export function registerWindowHandlers(): void {
  ipcMain.handle('window:reload', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.reload()
  })

  ipcMain.handle('window:toggle-devtools', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools()
  })

  ipcMain.handle('window:reset-zoom', (event) => {
    const wc = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (wc) wc.setZoomLevel(0)
  })

  ipcMain.handle('window:zoom-in', (event) => {
    const wc = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (wc) wc.setZoomLevel(wc.getZoomLevel() + 0.5)
  })

  ipcMain.handle('window:zoom-out', (event) => {
    const wc = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (wc) wc.setZoomLevel(wc.getZoomLevel() - 0.5)
  })

  ipcMain.handle('window:toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.setFullScreen(!win.isFullScreen())
  })

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:quit', () => {
    app.quit()
  })
}
