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

import { ipcMain, type BrowserWindow } from 'electron'
import updaterPkg from 'electron-updater'
import { checkForUpdate } from './update'

const { autoUpdater } = updaterPkg

let wired = false
let fallbackDone = false

export function initAutoUpdate(getWin: () => BrowserWindow | null): void {
  if (wired) return
  wired = true

  autoUpdater.autoDownload = false // stáhnout až na výslovné přání uživatele
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel: string, payload?: unknown): void => {
    getWin()?.webContents.send(channel, payload)
  }

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
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Kontrola po startu. Chyby (nepackovaný build, portable, offline) jdou do
  // 'error' handleru, který spustí fallback.
  autoUpdater.checkForUpdates().catch(() => {
    /* zpracováno v 'error' */
  })
}
