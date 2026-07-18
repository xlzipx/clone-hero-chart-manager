// Automatické aktualizace přes electron-updater (GitHub Releases).
//
// Instalační verze (NSIS) se umí aktualizovat sama: stáhne update na pozadí a
// nainstaluje ho při restartu. Portable .exe to neumí (nemá app-update.yml) —
// tam spadneme na ruční fallback (banner s odkazem na release).
//
// Tok:
//   start → checkForUpdates()
//     ok  → 'update-available' → UI nabídne „Download" → downloadUpdate()
//           → 'download-progress' → 'update-downloaded' → UI „Restart to install"
//           → quitAndInstall()
//     err → fallback: ruční GitHub API check → UI „View release" (manuální)

import { app, ipcMain, type BrowserWindow } from 'electron'
import updaterPkg from 'electron-updater'
import { checkForUpdate, isNewer } from './update'
import { isMac } from './platform'
import type { UpdateCheckResult } from '../../shared/types'
import { errMsg } from '../../shared/errors'

const { autoUpdater } = updaterPkg

// macOS buildy jsou zatím NEPODEPSANÉ → electron-updater na macu neumí instalovat
// (Squirrel.Mac vyžaduje podpis) a jen by házel chyby. Na macu proto auto-update
// úplně vypneme a spadneme na ruční „View release" banner (přímý GitHub check).
const AUTO_UPDATE_SUPPORTED = !isMac

let wired = false
let fallbackDone = false

export function initAutoUpdate(getWin: () => BrowserWindow | null): void {
  if (wired) return
  wired = true

  const send = (channel: string, payload?: unknown): void => {
    getWin()?.webContents.send(channel, payload)
  }

  if (!AUTO_UPDATE_SUPPORTED) {
    initManualUpdate(send)
    return
  }

  autoUpdater.autoDownload = false // stáhnout až na výslovné přání uživatele
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    send('update:available', { version: info.version, canAutoUpdate: true })
  })
  autoUpdater.on('download-progress', (p) => {
    send('update:progress', { percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    send('update:downloaded', { version: info.version })
  })
  autoUpdater.on('error', () => {
    // Auto-update nedostupný (portable / dev / offline) → jednou zkus ruční check.
    if (fallbackDone) return
    fallbackDone = true
    void checkForUpdate()
      .then((info) => {
        if (info?.hasUpdate) {
          send('update:available', { version: info.latest, canAutoUpdate: false, url: info.url })
        }
      })
      .catch(() => {
        /* ticho */
      })
  })

  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errMsg(e) }
    }
  })
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Ruční kontrola (tlačítko v Nastavení) — bez restartu, s definitivním výsledkem.
  ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => {
    const current = app.getVersion()
    // Instalační (NSIS) build: electron-updater. Když je novější verze, vyvolá
    // i 'update-available' event → banner s tlačítkem Download. V dev/portable
    // to hodí chybu → spadneme na přímý GitHub API check níž.
    try {
      const r = await autoUpdater.checkForUpdates()
      const latest = r?.updateInfo?.version
      if (latest) {
        if (isNewer(latest, current)) {
          return { status: 'available', version: latest, canAutoUpdate: true }
        }
        return { status: 'uptodate', version: current }
      }
    } catch {
      /* fallback níž */
    }
    // Portable / dev: přímý GitHub API check + ruční banner (View release).
    const info = await checkForUpdate()
    if (!info) return { status: 'error' }
    if (info.hasUpdate) {
      send('update:available', { version: info.latest, canAutoUpdate: false, url: info.url })
      return { status: 'available', version: info.latest, canAutoUpdate: false, url: info.url }
    }
    return { status: 'uptodate', version: info.current }
  })

  // Kontrola po startu — ODLOŽENÁ o pár sekund, ať síť + práce electron-updateru
  // nekonkuruje prvnímu vykreslení a úvodnímu hledání. Update není nic urgentního.
  // Chyby (nepackovaný build, portable, offline) jdou do 'error' handleru (fallback).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* zpracováno v 'error' */
    })
  }, 4000)
}

/**
 * Ruční režim aktualizací (macOS / nepodepsané buildy). Bez electron-updateru —
 * jen přímý GitHub API check a banner „View release". Download/Install se
 * nabídnou jako otevření release stránky v prohlížeči.
 */
function initManualUpdate(send: (channel: string, payload?: unknown) => void): void {
  ipcMain.handle('update:download', () => ({
    ok: false,
    error: 'Auto-update is not available on macOS builds — open the release page to download manually.'
  }))
  ipcMain.handle('update:install', () => {
    /* no-op: na macu se instaluje ručně z .dmg */
  })

  ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => {
    const info = await checkForUpdate()
    if (!info) return { status: 'error' }
    if (info.hasUpdate) {
      send('update:available', { version: info.latest, canAutoUpdate: false, url: info.url })
      return { status: 'available', version: info.latest, canAutoUpdate: false, url: info.url }
    }
    return { status: 'uptodate', version: info.current }
  })

  // Odložený check po startu (stejná logika jako u Windows fallbacku).
  setTimeout(() => {
    void checkForUpdate()
      .then((info) => {
        if (info?.hasUpdate) {
          send('update:available', { version: info.latest, canAutoUpdate: false, url: info.url })
        }
      })
      .catch(() => {
        /* ticho */
      })
  }, 4000)
}
