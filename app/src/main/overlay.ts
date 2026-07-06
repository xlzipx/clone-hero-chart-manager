// Hlavní okno aplikace (frameless, vlastní titlebar). Normální okno – dá se
// alt-tabovat, není always-on-top.

import { app, BrowserWindow, screen, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { getConfig } from './core/config'
import { bringGameToFront, runningGame } from './core/gamedetect'
import { hideReminder, showReminder } from './reminder'

/** Základní zoom UI (nad Windows DPI scalingem). Násobí se uživatelským uiScale. */
const BASE_ZOOM = 1.15

/** Cesta k ikoně okna (v devu), pokud existuje. */
function windowIcon(): string | undefined {
  const p = join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(p) ? p : undefined
}

let mainWindow: BrowserWindow | null = null

export function getOverlay(): BrowserWindow | null {
  return mainWindow
}

/** Živě aplikuje UI scale na hlavní okno (náhled z Nastavení). */
export function applyUiScale(scale: number): void {
  // Clamp z obou stran — extrémní hodnota z IPC by udělala UI neovladatelné.
  const s = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 3) : 1
  mainWindow?.webContents.setZoomFactor(BASE_ZOOM * s)
}

export function createOverlay(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { width, height } = primary.workAreaSize

  // Zoom RESPEKTUJE Windows DPI scaling: Electron `zoomFactor` se s ním násobí,
  // což je správně — kdo si dá 125/150 %, chce větší UI. (Dřív jsme dělili
  // scaleFactorem, což scaling zrušilo a na 4K@125 % bylo UI moc malé.)
  // Uživatel si může doladit přes `uiScale` v Nastavení.
  const uiScale = getConfig().uiScale || 1
  const ZOOM = BASE_ZOOM * uiScale

  // Rozměry okna v „design" CSS px → DIP přes ZOOM, VŽDY clampnuté na work area,
  // ať okno nikdy netrčí přes okraj obrazovky. Právě to (ne velikost zoomu) byl
  // ten „odd" stav na malých HiDPI displejích (1080p @ 150 %): okno se otevřelo
  // širší než obrazovka. Clamp to řeší bez zmenšování UI.
  const dip = (css: number): number => Math.round(css * ZOOM)
  const winW = Math.min(Math.max(dip(1304), Math.round(width * 0.7)), width)
  const winH = Math.min(Math.max(dip(870), Math.round(height * 0.78)), height)
  const minW = Math.min(dip(1026), width)
  const minH = Math.min(dip(661), height)

  const win = new BrowserWindow({
    title: 'Clone Hero Chart Manager',
    width: winW,
    height: winH,
    minWidth: minW,
    minHeight: minH,
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

  // Externí odkazy otevírat v prohlížeči, ne v okně. Validace schématu (jako
  // v IPC shell:openExternal) — data v odkazech pochází z RV/Encore API, takže
  // `file:`/jiné schéma by nemělo dostat šanci spustit lokální handler.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Reveal bez „poloprůhledného záseku": u transparent frameless okna dělá
  // Windows (DWM) při show() pomalé prolnutí, kdy je okno ~1 s poloprůhledné a
  // prosvítá skrz něj plocha/okno za ním. Řídíme si náběh sami — ukážeme okno
  // s nulovou krytím (DWM prolnutí tak proběhne neviditelně) a pak ho krátce a
  // plynule zvýšíme na plnou krytí.
  win.once('ready-to-show', () => {
    win.setOpacity(0)
    win.show()
    const startedAt = Date.now()
    const DURATION_MS = 160
    const fade = (): void => {
      if (win.isDestroyed()) return
      const t = Math.min(1, (Date.now() - startedAt) / DURATION_MS)
      win.setOpacity(t)
      if (t < 1) setTimeout(fade, 16)
      else win.setOpacity(1)
    }
    fade()
  })

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
