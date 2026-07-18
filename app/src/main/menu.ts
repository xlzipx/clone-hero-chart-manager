// Aplikační menu.
//
// Na Windows běží appka jako frameless overlay bez menu baru — necháváme to tak
// (žádné menu nenastavujeme). Na macOS je ale menu bar globální (v horní liště
// systému) a bez vlastního menu by appka měla generické "Electron" menu a
// chyběly by standardní Cmd+Q / Cmd+C/V/A / Cmd+W zkratky. Proto na macu
// sestavíme minimální, ale správné menu.

import { app, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { isMac } from './core/platform'
import { getOverlay, revealOverlay, toggleMaximize } from './overlay'

export function setupAppMenu(): void {
  if (!isMac) return // Windows: ponecháme bez menu (frameless overlay)

  const appName = app.name
  const template: MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Show Window',
          accelerator: 'Cmd+Shift+O',
          click: () => revealOverlay()
        },
        {
          label: 'Toggle Maximize',
          accelerator: 'Cmd+Ctrl+F',
          click: () => toggleMaximize()
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        {
          label: 'Close',
          accelerator: 'Cmd+W',
          // Náš „Close" = schovat okno (appka žije dál jako overlay v tray/docku),
          // ne zavřít proces. Konzistentní s křížkem v UI.
          click: () => getOverlay()?.hide()
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
