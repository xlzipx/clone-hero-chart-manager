// Vstupní bod main procesu.

import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { createOverlay, getOverlay } from './overlay'
import { destroyReminder } from './reminder'
import { createTray, destroyTray } from './tray'
import { initAutoUpdate } from './core/autoupdate'

// Jediná instance aplikace.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getOverlay()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpc()
    createOverlay()
    createTray()
    registerHotkeys()
    initAutoUpdate(getOverlay)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createOverlay()
    })
  })

  app.on('will-quit', () => {
    unregisterHotkeys()
    destroyTray()
    destroyReminder()
  })

  // Nechceme zavřít appku při zavření okna (běží jako overlay na pozadí).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
