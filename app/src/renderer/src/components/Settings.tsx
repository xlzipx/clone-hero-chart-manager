import { useEffect, useRef, useState } from 'react'
import type { AppConfig, ReminderPosition } from '../../../shared/types'
import { useStore } from '../store'
import { HotkeyInput } from './HotkeyInput'
import { Icon } from './Icon'

const POSITIONS: { v: ReminderPosition; l: string }[] = [
  { v: 'top-left', l: 'Top-left' },
  { v: 'top-right', l: 'Top-right' },
  { v: 'bottom-left', l: 'Bottom-left' },
  { v: 'bottom-right', l: 'Bottom-right' }
]

/** Mini dropdown laděný stejně jako náš obecný .dd komponent (tmavé téma). */
function PositionPicker({
  value,
  onChange
}: {
  value: ReminderPosition
  onChange: (v: ReminderPosition) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = POSITIONS.find((o) => o.v === value)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className={`dd dd--pos ${open ? 'dd--open' : ''}`} ref={ref}>
      <button type="button" className="dd__btn" onClick={() => setOpen((o) => !o)}>
        <span>{current?.l}</span>
        <Icon name="caret" size={11} className="dd__caret" />
      </button>
      {open ? (
        <ul className="dd__menu" role="listbox">
          {POSITIONS.map((o) => (
            <li key={o.v}>
              <button
                type="button"
                role="option"
                aria-selected={o.v === value}
                className={`dd__item ${o.v === value ? 'dd__item--sel' : ''}`}
                onClick={() => {
                  onChange(o.v)
                  setOpen(false)
                }}
              >
                {o.l}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function Settings(): JSX.Element | null {
  const show = useStore((s) => s.showSettings)
  const config = useStore((s) => s.config)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const saveConfig = useStore((s) => s.saveConfig)
  const [draft, setDraft] = useState<AppConfig | null>(config)
  const [exeStatus, setExeStatus] = useState<{ path: string | null; autoDetected: boolean } | null>(
    null
  )
  const [yargStatus, setYargStatus] = useState<{
    path: string | null
    autoDetected: boolean
  } | null>(null)

  useEffect(() => setDraft(config), [config])

  // Při otevření zjistíme, jestli CH.exe + YARG.exe auto-detekce našly cesty.
  useEffect(() => {
    if (!show) return
    void window.api.chExeStatus().then(setExeStatus)
    void window.api.yargExeStatus().then(setYargStatus)
  }, [show, draft?.songsDir, draft?.chExePath, draft?.yargExePath])

  if (!show || !draft) return null

  const pickDir = async (key: 'songsDir') => {
    const dir = await window.api.chooseDirectory()
    if (dir) setDraft({ ...draft, [key]: dir })
  }

  const pickChExe = async (): Promise<void> => {
    const file = await window.api.chooseExeFile()
    if (file) setDraft({ ...draft, chExePath: file })
  }
  const pickYargExe = async (): Promise<void> => {
    const file = await window.api.chooseExeFile()
    if (file) setDraft({ ...draft, yargExePath: file })
  }

  // Pole je teď viditelné vždy — uživatel může chtít přepsat auto-detekci
  // (např. pokud má víc instalací CH).

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        // Zavři jen když stisk začal přímo na pozadí (ne tažením z inputu ven).
        if (e.target === e.currentTarget) setShowSettings(false)
      }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Settings</h2>
          <button className="modal__close" onClick={() => setShowSettings(false)}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span>Songs folder (Clone Hero library)</span>
            <div className="field__row">
              <input
                value={draft.songsDir}
                onChange={(e) => setDraft({ ...draft, songsDir: e.target.value })}
              />
              <button onClick={() => pickDir('songsDir')}>…</button>
            </div>
          </label>

          <label className="field">
            <span>
              Clone Hero.exe path
              {exeStatus?.path === null && !draft.chExePath ? (
                <em className="field__warn"> — couldn't auto-detect, set manually</em>
              ) : exeStatus?.autoDetected && !draft.chExePath ? (
                <em className="field__hint" style={{ marginLeft: 6 }}>
                  — auto-detected, override below if needed
                </em>
              ) : null}
            </span>
            <div className="field__row">
              <input
                placeholder={
                  exeStatus?.autoDetected && exeStatus.path
                    ? `Using: ${exeStatus.path}`
                    : 'e.g. C:\\Games\\Clone Hero\\Clone Hero.exe'
                }
                value={draft.chExePath}
                onChange={(e) => setDraft({ ...draft, chExePath: e.target.value })}
              />
              <button onClick={pickChExe} title="Browse for Clone Hero.exe">
                …
              </button>
            </div>
            <p className="field__hint">
              Used by the <strong>Launch Clone Hero</strong> button. Leave blank to use
              auto-detection (parent of the Songs folder, then known install paths).
            </p>
          </label>

          <label className="field">
            <span>
              YARG.exe path
              {yargStatus?.path === null && !draft.yargExePath ? (
                <em className="field__hint" style={{ marginLeft: 6 }}>
                  — not detected (set manually if installed)
                </em>
              ) : yargStatus?.autoDetected && !draft.yargExePath ? (
                <em className="field__hint" style={{ marginLeft: 6 }}>
                  — auto-detected, override below if needed
                </em>
              ) : null}
            </span>
            <div className="field__row">
              <input
                placeholder={
                  yargStatus?.autoDetected && yargStatus.path
                    ? `Using: ${yargStatus.path}`
                    : 'e.g. C:\\YARG\\Content\\YARG Installs\\<GUID>\\installation\\YARG.exe'
                }
                value={draft.yargExePath}
                onChange={(e) => setDraft({ ...draft, yargExePath: e.target.value })}
              />
              <button onClick={pickYargExe} title="Browse for YARG.exe">
                …
              </button>
            </div>
            <p className="field__hint">
              Used by the overlay + hotkey to detect YARG. CHM also brings YARG back to the
              foreground when you hide this window. YARG reads charts from Clone Hero's Songs
              folder, so no separate library is needed.
            </p>
          </label>

          <div className="field field--inline">
            <label className="field">
              <span>Results per page</span>
              <input
                type="number"
                min={5}
                max={100}
                value={draft.recordsPerPage}
                onChange={(e) =>
                  setDraft({ ...draft, recordsPerPage: Number(e.target.value) || 25 })
                }
              />
            </label>
          </div>

          <fieldset className="field">
            <span>
              Hotkey reminder over the game
              <span
                className="info"
                title="Small floating pill in a corner of the screen showing the show/hide hotkey. Appears for ~7 seconds when Clone Hero starts (or when you hide this window with the hotkey)."
              >
                <Icon name="info" size={13} />
              </span>
            </span>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.showReminder}
                onChange={(e) => setDraft({ ...draft, showReminder: e.target.checked })}
              />
              <span>Show a tiny floating reminder over the game</span>
            </label>
            {draft.showReminder ? (
              <div className="check__sub">
                <span className="check__sub-label">Position</span>
                <PositionPicker
                  value={draft.reminderPosition}
                  onChange={(v) => setDraft({ ...draft, reminderPosition: v })}
                />
              </div>
            ) : null}
            <p className="field__hint">
              Works over windowed / borderless games. Won't appear over exclusive fullscreen
              (Windows limitation). Auto‑hides after a few seconds.
            </p>
          </fieldset>

          <fieldset className="field">
            <span>Quick toggle hotkey (optional)</span>
            <div className="field__row">
              <label className="hk">
                <span className="hk__label">
                  Show / hide window
                  <span
                    className="info"
                    title="Global hotkey – works even when the game window has focus. Most users don't need it (just Alt+Tab to bring the app forward)."
                  >
                    <Icon name="info" size={13} />
                  </span>
                </span>
                <HotkeyInput
                  value={draft.hotkeys.toggleOverlay}
                  onChange={(v) =>
                    setDraft({ ...draft, hotkeys: { ...draft.hotkeys, toggleOverlay: v } })
                  }
                />
              </label>
            </div>
            <p className="field__hint">
              Optional global shortcut to bring the app forward from anywhere. Most users just use
              Alt+Tab — leave it blank to disable. Click the field and press a key or combo (e.g.{' '}
              <code>F10</code> or <code>Control+Shift+H</code>); Backspace clears it.
            </p>
          </fieldset>
        </div>

        <div className="modal__foot">
          <button className="btn-secondary" onClick={() => setShowSettings(false)}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={async () => {
              await saveConfig(draft)
              setShowSettings(false)
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
