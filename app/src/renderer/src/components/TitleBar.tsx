import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'
import { TipsTicker } from './TipsTicker'

/**
 * Horní řádek obsahu (redesign v2): jen textový brand „Chart Manager" vlevo,
 * vpravo Search / Library / Settings / minimize / close. Verze + „check for updates"
 * jsou dole v Sidebaru. Celý pruh je drag oblast okna.
 */
export function TitleBar(): JSX.Element {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showSettings = useStore((s) => s.showSettings)
  const setShowLibrary = useStore((s) => s.setShowLibrary)
  const showLibrary = useStore((s) => s.showLibrary)
  const setShowAbout = useStore((s) => s.setShowAbout)
  const [maximized, setMaximized] = useState(false)

  // Drž ikonu tlačítka v syncu se skutečným stavem okna (i když se maximalizuje
  // jinak — Aero Snap, Win+↑, dvojklik): main posílá `overlay:maximized`.
  useEffect(() => {
    void window.api.isMaximized().then(setMaximized)
    return window.api.onMaximizeChange(setMaximized)
  }, [])

  // Dvojklik na TAŽNOU část titlebaru = maximalizovat/obnovit (jako nativní okno).
  // Interaktivní prvky (tlačítka, tipy) přeskoč, ať se nepřekrývá s jejich akcí.
  const onDoubleClick = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest('button, a, input, [role="button"]')) return
    window.api.toggleMaximize()
  }

  return (
    <div className="titlebar" onDoubleClick={onDoubleClick}>
      {/* Logo = vstup do About. Titlebar je drag oblast, takže tlačítko musí mít
          `no-drag` (v CSS), jinak by ho okno „snědlo" a klik by netrefil. */}
      <button
        className="titlebar__left titlebar__brandbtn"
        title="About Chart Manager"
        onClick={() => setShowAbout(true)}
      >
        {/* Rytmická značka = 4 EQ pruhy v barvách nástrojů (matchuje brand/ikonu). */}
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="brand-text">
          <span className="brand-w1">Chart</span> <span className="brand-w2">Manager</span>
          <span className="brand-dot">.</span>
        </span>
      </button>

      <TipsTicker />

      <div className="titlebar__actions">
        {/* Navigace Search / Library: zvýrazněné je tlačítko místa, kde právě
            jste (v Nastavení ani jedno). Obě fungují odkudkoli, i z Nastavení. */}
        <button
          className={`titlebar__library titlebar__search ${!showLibrary && !showSettings ? '' : 'titlebar__library--idle'}`}
          title="Search for charts (your search is kept)"
          aria-current={!showLibrary && !showSettings ? 'page' : undefined}
          onClick={() => setShowLibrary(false)}
        >
          <Icon name="search" size={15} />
          <span>Search</span>
        </button>
        <button
          className={`titlebar__library ${showLibrary && !showSettings ? '' : 'titlebar__library--idle'}`}
          title="Browse and manage your Songs library: folders, metadata, setlists, duplicates"
          aria-current={showLibrary && !showSettings ? 'page' : undefined}
          onClick={() => setShowLibrary(true)}
        >
          <Icon name="folder" size={15} />
          <span>Library</span>
        </button>
        <button
          className={`titlebar__btn ${showSettings ? 'titlebar__btn--on' : ''}`}
          title="Settings"
          aria-current={showSettings ? 'page' : undefined}
          // Jen otevírá; zpět se jde přes Search / Library (nebo Done, Esc).
          onClick={() => setShowSettings(true)}
        >
          <Icon name="settings" size={16} />
        </button>
        <button
          className="titlebar__btn"
          title="Hide window"
          onClick={() => window.api.hideOverlay()}
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          className="titlebar__btn"
          title={maximized ? 'Restore window' : 'Maximize window'}
          onClick={() => window.api.toggleMaximize()}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={15} />
        </button>
        <button
          className="titlebar__btn titlebar__btn--close"
          title="Quit program"
          onClick={() => window.api.quitApp()}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  )
}
