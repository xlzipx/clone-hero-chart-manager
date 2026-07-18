// Vstupní bod main procesu.

import { app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { registerIpc, stopGamePoll } from './ipc'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { setupAppMenu } from './menu'
import { createOverlay, getOverlay, revealOverlay } from './overlay'
import { destroyReminder } from './reminder'
import { createTray, destroyTray } from './tray'
import { initAutoUpdate } from './core/autoupdate'
import { isMac, isWin } from './core/platform'

// Windows: GPU kompozitor (DirectComposition) při zvětšování okna dočasně
// „vydláždí" poslední snímek do nově odkryté plochy → viditelný smearing /
// duplikace obsahu u pravého a spodního okraje během resize. Vypnutí HW
// akcelerace přepne renderer na software rasterizaci, která tenhle artefakt
// nedělá. Musí se zavolat PŘED app 'ready'. Appka je jen seznam (žádné
// video/canvas/3D), takže dopad na běžnou plynulost je zanedbatelný.
if (isWin) app.disableHardwareAcceleration()

/**
 * macOS: v DEV režimu (spuštěno přes `electron`) nemá běžící proces .app bundle,
 * takže Dock i přepínač aplikací (Cmd+Tab / Spotlight) ukazují defaultní ikonu
 * Electronu. Nastavíme ji ručně. V zabalené appce už ikonu řeší icns z build
 * configu — ale zavolat to neuškodí.
 */
function setMacDockIcon(): void {
  if (!isMac || !app.dock) return
  const icon = join(app.getAppPath(), 'build', 'icon-1024.png')
  if (existsSync(icon)) app.dock.setIcon(icon)
}

// Jediná instance aplikace.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    revealOverlay()
  })

  app.whenReady().then(() => {
    setMacDockIcon()
    setupAppMenu()
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
    stopGamePoll()
    destroyTray()
    destroyReminder()
  })

  // Nechceme zavřít appku při zavření okna (běží jako overlay na pozadí).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
