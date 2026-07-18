// Malý floating reminder pill nad hrou ("Press Ctrl+I → CHM").
//
// Detaily:
//   - Druhé BrowserWindow, click-through (setIgnoreMouseEvents), focusable: false.
//   - Frame-less + transparent, alwaysOnTop level 'screen-saver'.
//   - skipTaskbar: true – v hlavním panelu se neobjeví.
//   - Obsah je inline HTML v data: URL (žádný extra renderer build).
//   - Auto-fade po ~8 sekundách (CSS animace + JS hide po expiraci).
//   - Pozice = jeden ze 4 rohů primárního monitoru, 24 px margin.

import { BrowserWindow, screen } from 'electron'
import type { ReminderPosition } from '../shared/types'
import { isMac } from './core/platform'
import { getConfig } from './core/config'

// Okno je "canvas" — pill uvnitř má auto šířku podle obsahu a centrujeme ho.
// Větší okno než pill, aby měl prostor pro drop-shadow.
const WIDTH = 260
const HEIGHT = 60
const MARGIN = 30

let reminder: BrowserWindow | null = null

function positionFor(pos: ReminderPosition): { x: number; y: number } {
  const work = screen.getPrimaryDisplay().workArea
  switch (pos) {
    case 'top-left':
      return { x: work.x + MARGIN, y: work.y + MARGIN }
    case 'top-right':
      return { x: work.x + work.width - WIDTH - MARGIN, y: work.y + MARGIN }
    case 'bottom-left':
      return { x: work.x + MARGIN, y: work.y + work.height - HEIGHT - MARGIN }
    case 'bottom-right':
    default:
      return {
        x: work.x + work.width - WIDTH - MARGIN,
        y: work.y + work.height - HEIGHT - MARGIN
      }
  }
}

/** Formátuje hotkey pro UI. Na macu nativní symboly s „+" (⌘+I),
 *  na Windows textové názvy (Ctrl + I). */
function formatHotkey(accel: string): string {
  if (!accel) return '—'
  return accel
    .split('+')
    .map((p) => {
      const s = p.trim()
      const l = s.toLowerCase()
      if (isMac) {
        if (l === 'command' || l === 'cmd' || l === 'meta' || l === 'super') return '⌘'
        if (l === 'control' || l === 'ctrl') return '⌃'
        if (l === 'alt' || l === 'option') return '⌥'
        if (l === 'shift') return '⇧'
        return s
      }
      if (l === 'control') return 'Ctrl'
      if (l === 'shift') return 'Shift'
      if (l === 'alt') return 'Alt'
      if (l === 'super' || l === 'meta') return 'Win'
      return s
    })
    .join(isMac ? '+' : ' + ')
}

/** Inline HTML pro pill — substituuje aktuální hotkey.
 *  Glassmorphism look: vícestupňový průhledný podklad + jemný highlight + blur.
 *  Žádná out-animace — pill zůstává viditelný dokud hra běží. */
function pillHtml(hotkey: string): string {
  const label = formatHotkey(hotkey)
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;height:100vh;width:100vw;overflow:hidden;background:transparent;
    font-family:'Segoe UI',system-ui,sans-serif;-webkit-user-select:none;color:#f5f3ff;
    /* Centrujeme pill – auto šířka, žádné stretchování. */
    display:flex;align-items:center;justify-content:center;}
  .pill{
    display:inline-flex;align-items:center;gap:12px;
    border-radius:999px;padding:9px 16px;
    font-size:17px;font-weight:600;letter-spacing:.4px;
    /* Neutral frosted glass — žádný akcent tint, jen tmavé sklo s highlightem. */
    background:
      linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 55%),
      rgba(20, 22, 30, 0.55);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    border: 1px solid rgba(255,255,255,0.16);
    box-shadow:
      0 14px 36px rgba(0,0,0,0.6),
      0 0 0 1px rgba(0,0,0,0.28) inset,
      0 1px 0 rgba(255,255,255,0.22) inset;
    animation:in .35s cubic-bezier(.16,1,.3,1) both;
  }
  .pick{
    width:28px;height:28px;flex-shrink:0;
    color:#ffffff;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.55));
  }
  kbd{
    font-family:'Segoe UI',sans-serif;font-size:16px;font-weight:800;
    background:rgba(0,0,0,0.42);
    border:1px solid rgba(255,255,255,0.14);
    border-radius:9px;padding:6px 13px;
    box-shadow:
      0 1px 0 rgba(255,255,255,0.22) inset,
      0 3px 6px rgba(0,0,0,0.4);
    color:#fff;
    letter-spacing:.6px;
  }
  @keyframes in{from{opacity:0;transform:translateY(8px) scale(.94)}to{opacity:1;transform:none}}
</style></head>
<body>
  <div class="pill">
    <svg class="pick" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 2.5c4.2 0 7.5 3 7.5 7 0 5-5.2 10.5-7.5 12-2.3-1.5-7.5-7-7.5-12 0-4 3.3-7 7.5-7Z"/>
    </svg>
    <kbd>${escapeHtml(label)}</kbd>
  </div>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
  )
}

/** Vytvoří (pokud neexistuje) reminder okno. Nezobrazí ho — to dělá show(). */
function ensureWindow(): BrowserWindow {
  if (reminder && !reminder.isDestroyed()) return reminder
  reminder = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false, // klíčové — neukradne focus hře
    show: false,
    hasShadow: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  reminder.setAlwaysOnTop(true, 'screen-saver')
  reminder.setIgnoreMouseEvents(true, { forward: false })
  reminder.on('closed', () => {
    reminder = null
  })
  return reminder
}

/** Zobrazí reminder — pill zůstane viditelný dokud ho explicitně nezhasneme
 *  (hide game / show CHM). Žádný auto-hide. */
export function showReminder(): void {
  const cfg = getConfig()
  if (!cfg.showReminder) return
  const win = ensureWindow()

  const pos = positionFor(cfg.reminderPosition)
  win.setBounds({ x: pos.x, y: pos.y, width: WIDTH, height: HEIGHT })

  const html = pillHtml(cfg.hotkeys.toggleOverlay)
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.showInactive() // ukáže, ale NEPŘEDÁ focus
}

export function hideReminder(): void {
  if (reminder && !reminder.isDestroyed() && reminder.isVisible()) {
    reminder.hide()
  }
}

export function destroyReminder(): void {
  hideReminder()
  if (reminder && !reminder.isDestroyed()) reminder.close()
  reminder = null
}
