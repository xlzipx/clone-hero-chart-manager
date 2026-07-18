// Ikona v system tray — aplikace je dostupná i když je okno skryté.

import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { revealOverlay, toggleOverlay } from './overlay'

let tray: Tray | null = null

function trayImage(): Electron.NativeImage {
  const p = join(app.getAppPath(), 'build', 'icon.png')
  if (existsSync(p)) {
    return nativeImage.createFromPath(p).resize({ width: 16, height: 16 })
  }
  return nativeImage.createEmpty()
}

export function createTray(): void {
  if (tray) return
  tray = new Tray(trayImage())
  tray.setToolTip('CH - PickUp Chart')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show / hide window',
        click: () => toggleOverlay()
      },
      {
        label: 'Show window',
        click: () => revealOverlay()
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  // Levý klik na ikonu přepne overlay.
  tray.on('click', () => toggleOverlay())
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
