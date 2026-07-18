// Hlavní okno aplikace (frameless, vlastní titlebar). Normální okno – dá se
// alt-tabovat, není always-on-top.

import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { getConfig } from './core/config'
import { bringGameToFront, runningGame } from './core/gamedetect'
import { hideReminder, showReminder } from './reminder'

/** Základní zoom UI (nad Windows DPI scalingem). Násobí se uživatelským uiScale.
 *  REDESIGN v2: 1.0 — CSS je autorované 1:1 v pixelech mockupu (okno 1500×1044),
 *  žádné dodatečné zvětšování. */
const BASE_ZOOM = 1.0

/** Cesta k ikoně okna (v devu), pokud existuje. */
function windowIcon(): string | undefined {
  const p = join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(p) ? p : undefined
}

let mainWindow: BrowserWindow | null = null

export function getOverlay(): BrowserWindow | null {
  return mainWindow
}

/** Přepne maximalizaci hlavního okna (tlačítko v titlebaru / dvojklik). */
export function toggleMaximize(): void {
  const win = mainWindow
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
}

/** Je hlavní okno maximalizované? (počáteční stav ikony tlačítka). */
export function isMaximized(): boolean {
  return mainWindow?.isMaximized() ?? false
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
  // Okno se VŽDY otevírá v „design" velikosti mockupu (1500×1044 CSS px),
  // jen clampnuté na pracovní plochu — na menších displejích se zmenší,
  // ale na velkých se uměle nenafukuje.
  const winW = Math.min(dip(1500), width)
  const winH = Math.min(dip(1044), height)
  const minW = Math.min(dip(1100), width)
  const minH = Math.min(dip(700), height)

  const win = new BrowserWindow({
    title: 'Clone Hero Chart Manager',
    width: winW,
    height: winH,
    minWidth: minW,
    minHeight: minH,
    center: true,
    show: false,
    frame: false,
    // NEPRŮHLEDNÉ okno (dřív `transparent: true` kvůli CSS zaobleným rohům). Na
    // Windows jsou ale transparent/layered okna vyloučená z Aero Snapu i nativní
    // maximalizace. Neprůhledné okno si Windows převezme nativně: Win11 DWM samo
    // zaoblí rohy + dá stín, funguje Snap, Win+šipky i maximalizace.
    backgroundColor: '#0e0e10', // = --bg appky, ať není barevný záblesk před renderem
    hasShadow: true,
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

  // Kontextové menu (pravý klik). Electron ho editovatelným polím NEDÁVÁ
  // automaticky, takže bez tohohle šlo vkládat jen přes Ctrl+V. V inputech
  // Cut/Copy/Paste/Select all (podle editFlags), jinak Copy nad výběrem textu.
  win.webContents.on('context-menu', (_e, params) => {
    const { isEditable, editFlags, selectionText } = params
    const template: MenuItemConstructorOptions[] = []
    if (isEditable) {
      template.push(
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' }
      )
    } else if (selectionText && selectionText.trim()) {
      template.push({ role: 'copy' })
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win })
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Neprůhledné okno se ukáže bez triků — DWM u něj nedělá ten „poloprůhledný
  // zásek" jako u transparentního, takže stačí prostý show() po prvním vykreslení.
  win.once('ready-to-show', () => win.show())

  // Stav maximalizace posíláme rendereru, ať přepne ikonu tlačítka (maximalizovat
  // ↔ obnovit). Frameless okno nemá nativní tlačítko, řešíme si ho v UI.
  const sendMax = (): void => {
    if (!win.isDestroyed()) win.webContents.send('overlay:maximized', win.isMaximized())
  }
  win.on('maximize', sendMax)
  win.on('unmaximize', sendMax)

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
/**
 * INSTANTNÍ skrytí — bez DWM fade-out animace. Neprůhledné okno Windows při
 * `hide()` animuje (zavírací prolnutí), což je u velkého okna trhané. Nastavením
 * opacity na 0 okno zmizí OKAMŽITĚ (setOpacity není animovaný), takže i kdyby DWM
 * animaci spustil, není co prolínat. `revealOverlay` pak opacity vrátí na 1 (což
 * zároveň sundá WS_EX_LAYERED → Aero Snap dál funguje). */
function hideInstant(win: BrowserWindow): void {
  win.setOpacity(0)
  win.hide()
}

/** Ukáže hlavní okno (opacity zpět na 1 po případném instantním skrytí) + focus. */
export function revealOverlay(): void {
  const win = mainWindow
  if (!win) return
  hideReminder() // hlavní okno bude vidět → reminder pill je zbytečný
  win.setOpacity(1)
  win.show()
  win.focus()
}

export async function toggleOverlay(): Promise<void> {
  const win = mainWindow
  if (!win) return
  if (win.isVisible() && win.isFocused()) {
    hideInstant(win)
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
    revealOverlay()
  }
}

/** Skryje okno (Hide tlačítko / IPC) — taky vrátí focus na hru. */
export async function hideOverlay(): Promise<void> {
  const win = mainWindow
  if (!win) return
  hideInstant(win)
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
