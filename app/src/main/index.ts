// Vstupní bod main procesu.

import { app, BrowserWindow } from 'electron'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { registerIpc, stopGamePoll } from './ipc'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { setupAppMenu } from './menu'
import { createOverlay, getOverlay, revealOverlay } from './overlay'
import { destroyReminder } from './reminder'
import { createTray, destroyTray } from './tray'
import { initAutoUpdate } from './core/autoupdate'
import { isMac, isWin } from './core/platform'
import { handleAudioProtocol, registerAudioScheme } from './core/localaudio'
import { closeCatalog, ensureCatalogSeed, initCatalog } from './core/catalog'
import { scheduleCatalogSync, stopCatalogSync } from './core/catalogsync'

/**
 * Windows: při tažení za okraj se rám okna zvětší okamžitě, ale obsah dobíhá a
 * do nově odkryté plochy se roztáhne/zopakuje poslední snímek (duchové na pravé
 * a spodní hraně). Dělá to prezentace přes DirectComposition — swap chain se
 * škáluje, dokud renderer nedodá nový snímek. Bez ní Chromium prezentuje starší
 * cestou, která překresluje rovnou do okna.
 *
 * NENÍ to totéž co `disableHardwareAcceleration()` (to jsme zkoušeli a bylo to
 * horší) — GPU rasterizace i kompozice zůstávají, mění se jen způsob prezentace.
 */
if (isWin) app.commandLine.appendSwitch('disable-direct-composition')

// Vlastní schéma pro zvuk písní z knihovny. MUSÍ se zaregistrovat dřív, než je
// app ready — potom už Chromium seznam schémat nepřebírá.
registerAudioScheme()

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
    handleAudioProtocol()
    setupAppMenu()
    registerIpc()
    createOverlay()
    createTray()
    registerHotkeys()
    initAutoUpdate(getOverlay)

    // Lokální katalog metadat: při PRVNÍM spuštění rozbalit přibalený seed
    // (instalátor nese snapshot celého katalogu → nemusí se stahovat z API),
    // pak otevřít DB a naplánovat sync (delta dožene novinky od buildu).
    // Selhání nesmí shodit appku — bez katalogu vše funguje přes živá API.
    void (async () => {
      const dbPath = join(app.getPath('userData'), 'catalog.db')
      // Zabalená appka má seed v resources; v DEV ukazuje resourcesPath do
      // Electronu → seed se bere přímo z build/ (tam ho generuje seed skript).
      const seedGz = app.isPackaged
        ? join(process.resourcesPath, 'catalog-seed.db.gz')
        : join(app.getAppPath(), 'build', 'catalog-seed.db.gz')
      await ensureCatalogSeed(dbPath, seedGz)
      try {
        initCatalog(dbPath)
      } catch (err) {
        // Poškozená DB (přerušený zápis, vadný seed…) → smazat a načisto.
        console.warn('[catalog] open failed, recreating:', err)
        try {
          for (const suf of ['', '-wal', '-shm']) rmSync(dbPath + suf, { force: true })
          initCatalog(dbPath)
        } catch (err2) {
          console.warn('[catalog] init failed:', err2)
          return
        }
      }
      scheduleCatalogSync((s) => getOverlay()?.webContents.send('catalog:status', s))
    })()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createOverlay()
    })
  })

  app.on('will-quit', () => {
    unregisterHotkeys()
    stopGamePoll()
    stopCatalogSync()
    closeCatalog()
    destroyTray()
    destroyReminder()
  })

  // Nechceme zavřít appku při zavření okna (běží jako overlay na pozadí).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
