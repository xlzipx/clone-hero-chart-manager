// Hlavní okno aplikace (frameless, vlastní titlebar). Normální okno – dá se
// alt-tabovat, není always-on-top.

import { app, BrowserWindow, screen, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { bringGameToFront, runningGame } from './core/gamedetect'
import { hideReminder, showReminder } from './reminder'

/** Cesta k ikoně okna (v devu), pokud existuje. */
function windowIcon(): string | undefined {
  const p = join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(p) ? p : undefined
}

let mainWindow: BrowserWindow | null = null

export function getOverlay(): BrowserWindow | null {
  return mainWindow
}

export function createOverlay(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { width, height } = primary.workAreaSize

  // Default velikost okna — velkorysá, ať se vejde header + filter + dost
  // řádků výsledků pohodlně bez scrollování. Na menších monitorech to
  // Electron sám clampuje na velikost work area.
  // Minimum (níže) drží, aby header nepředvícoval — pod ně se okno nedá zmenšit.
  const winW = Math.max(1500, Math.round(width * 0.7))
  const winH = Math.max(1000, Math.round(height * 0.78))

  // Zvětšení celého UI – zoom sladěný s hustším layoutem.
  const ZOOM = 1.15

  const win = new BrowserWindow({
    title: 'Clone Hero Chart Manager',
    width: winW,
    height: winH,
    minWidth: 1180,
    minHeight: 760,
    center: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // OS shadow je tvrdý / nehezký u transparent okna – řešíme CSS
    resizable: true,
    skipTaskbar: false,
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: ZOOM
    }
  })

  // Zoom znovu aplikuj po načtení (a po hot-reloadu), ať drží.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(ZOOM)
  })

  // Externí odkazy otevírat v prohlížeči, ne v okně.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.once('ready-to-show', () => win.show())

  win.on('closed', () => {
    mainWindow = null
  })

  mainWindow = win
  return win
}

/**
 * Zobrazí / skryje okno (globální zkratka nebo tray).
 *
 * **Focus restore**: na Windows `win.hide()` jen schová naše okno, ale OS
 * sám neaktivuje předchozí okno (hru). Uživatel by musel kliknout. Proto
 * při skrytí, pokud Clone Hero běží, ho aktivně přepneme do popředí.
 */
export async function toggleOverlay(): Promise<void> {
  const win = mainWindow
  if (!win) return
  if (win.isVisible() && win.isFocused()) {
    win.hide()
    // Vrátí focus zpět na hru (pokud běží) — bez tohohle by uživatel musel
    // ručně kliknout na CH/YARG okno. + ukázat reminder pill.
    try {
      const game = await runningGame()
      if (game) {
        await bringGameToFront(game)
        showReminder()
      }
    } catch {
      /* nevadí — jen UX bonus */
    }
  } else {
    hideReminder() // hlavní okno bude vidět, reminder je pak zbytečný
    win.show()
    win.focus()
  }
}

/** Skryje okno (Hide tlačítko / IPC) — taky vrátí focus na hru. */
export async function hideOverlay(): Promise<void> {
  const win = mainWindow
  if (!win) return
  win.hide()
  try {
    const game = await runningGame()
    if (game) {
      await bringGameToFront(game)
      showReminder()
    }
  } catch {
    /* ignore */
  }
}
