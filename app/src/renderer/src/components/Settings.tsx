import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_FOLDER_TEMPLATE,
  FOLDER_TAGS,
  previewFolderPath,
  type FolderTagSource
} from '../../../shared/foldertemplate'
import type { AppConfig, ReminderPosition } from '../../../shared/types'
import { useStore } from '../store'
import { HotkeyInput } from './HotkeyInput'
import { Icon } from './Icon'

// Ukázková píseň pro náhled šablony. Má VYPLNĚNÉ všechny tagy, ať je hned vidět,
// co která značka udělá.
const SAMPLE_SONG: FolderTagSource = {
  artist: 'Metallica',
  title: 'Master of Puppets',
  album: 'Master of Puppets',
  genre: 'Metal',
  year: 1986,
  charter: 'Nickmein'
}

// Druhý náhled = píseň s CHYBĚJÍCÍMI metadaty (spousta chartů žánr/rok nemá).
// Ukáže, že prázdné podsložky se zahodí, místo aby vznikly složky „Unknown".
const SPARSE_SONG: FolderTagSource = {
  artist: 'Some Band',
  title: 'Untitled Demo',
  album: '',
  genre: '',
  year: null,
  charter: null
}

// Tagy, které reálný chart nemusí mít vyplněné. `{artist}`/`{title}` tu schválně
// NEJSOU — ty má prakticky vždycky.
const DROPPABLE_TAG_RE = /\{(genre|year|album|charter)\}/i

/**
 * Náhled = SKUTEČNÁ cesta na disku, od nastavené Songs složky.
 *
 * Proto zpětná lomítka, i když se šablona píše s `/`: v šabloně je `/` vstupní
 * syntaxe (a parser bere obojí), kdežto tady jde o cestu ve Windows, jakou uvidíš
 * v Průzkumníku. Ukázat plnou cestu je to, co ten rozdíl vysvětlí samo — půlka
 * cesty („Songs\…") vypadala jen jako nekonzistentní lomítko proti poli výše.
 */
function previewFullPath(song: FolderTagSource, template: string, songsDir: string): string {
  const base = (songsDir || '').replace(/[\\/]+$/, '') || 'Songs'
  return `${base}\\${previewFolderPath(song, template)}`
}

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
  // Šablona složky je zabalená (pokročilé) — stav si drží napříč otevřeními okna,
  // ať to kdo ji používá nemusí rozklikávat pořád dokola.
  const [tplOpen, setTplOpen] = useState(false)
  const [exeStatus, setExeStatus] = useState<{ path: string | null; autoDetected: boolean } | null>(
    null
  )
  const [yargStatus, setYargStatus] = useState<{
    path: string | null
    autoDetected: boolean
  } | null>(null)
  // Reset rozdělaných změn na uložený config při KAŽDÉM otevření okna (i po
  // změně configu). Komponenta se nemountuje znovu (jen vrací null), takže bez
  // tohohle by neuložené úpravy po Cancel/kliku mimo přežily do dalšího otevření.
  useEffect(() => {
    if (show) setDraft(config)
  }, [show, config])

  // Při otevření zjistíme, jestli CH.exe + YARG.exe auto-detekce našly cesty.
  useEffect(() => {
    if (!show) return
    void window.api.chExeStatus().then(setExeStatus)
    void window.api.yargExeStatus().then(setYargStatus)
  }, [show, draft?.songsDir, draft?.chExePath, draft?.yargExePath])

  // UI scale: clamp 0.7–1.6, živý náhled přes IPC (uloží se až na Save).
  const setScale = (next: number): void => {
    const clamped = Math.min(1.6, Math.max(0.7, Math.round(next * 10) / 10))
    setDraft((d) => (d ? { ...d, uiScale: clamped } : d))
    void window.api.setUiScale(clamped)
  }

  // Zavření bez uložení → zahoď živý náhled a vrať uloženou škálu.
  const cancelSettings = (): void => {
    void window.api.setUiScale(config?.uiScale ?? 1)
    setShowSettings(false)
  }

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
        if (e.target === e.currentTarget) cancelSettings()
      }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Settings</h2>
          <button className="modal__close" onClick={cancelSettings}>
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

          {/* Zabalené: běžný uživatel tohle nepotřebuje (výchozí šablona = chování
              odjakživa) a v nastavení by ho to jen mátlo. Kdo to zná z Bridge nebo
              si chce knihovnu třídit sám, si to rozklikne. Zavřený stav ukazuje
              aktuální šablonu, ať je vidět i bez otevírání. */}
          <fieldset className="field field--disc">
            <button
              type="button"
              className="disc__head"
              aria-expanded={tplOpen}
              onClick={() => setTplOpen((o) => !o)}
            >
              <span className="disc__titles">
                <span className="disc__title">
                  Chart folder name
                  <span className="disc__badge">Optional</span>
                </span>
                <span className="disc__sub">
                  Naming and sorting of downloaded charts: <code>{draft.folderTemplate}</code>
                </span>
              </span>
              <Icon name="caret" size={12} className="disc__caret" />
            </button>

            <div className={`disc ${tplOpen ? 'disc--open' : ''}`}>
              <div className="disc__inner">
                <div className="field__row">
                  <input
                    className="tpl__input"
                    value={draft.folderTemplate}
                    spellCheck={false}
                    placeholder={DEFAULT_FOLDER_TEMPLATE}
                    onChange={(e) => setDraft({ ...draft, folderTemplate: e.target.value })}
                  />
                  <button
                    onClick={() => setDraft({ ...draft, folderTemplate: DEFAULT_FOLDER_TEMPLATE })}
                    title="Reset to the default template"
                    disabled={draft.folderTemplate === DEFAULT_FOLDER_TEMPLATE}
                  >
                    Reset
                  </button>
                </div>

                <div className="tpl__tags">
                  {FOLDER_TAGS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="tpl__tag"
                      title={`Insert {${t}}`}
                      onClick={() =>
                        setDraft({ ...draft, folderTemplate: `${draft.folderTemplate}{${t}}` })
                      }
                    >
                      {`{${t}}`}
                    </button>
                  ))}
                </div>

                {/* Náhled běží přes TUTÉŽ funkci jako skutečná instalace (shared/
                    foldertemplate.ts), takže nemůže ukazovat něco jiného, než co se stane. */}
                <div className="tpl__preview">
                  <div className="tpl__prow">
                    <span className="tpl__plabel">Preview</span>
                    <code className="tpl__ppath">
                      {previewFullPath(SAMPLE_SONG, draft.folderTemplate, draft.songsDir)}
                    </code>
                  </div>
                  {/* Jen když má co ukázat. U výchozí `{artist} - {title}` by to byl
                      druhý namátkový příklad bez poučení (a přesně tak to mátlo). */}
                  {DROPPABLE_TAG_RE.test(draft.folderTemplate) ? (
                    <div className="tpl__prow">
                      <span className="tpl__plabel" title="Not every chart has a genre, year, album or charter filled in. A subfolder whose tags are all empty is skipped.">
                        Tags empty
                      </span>
                      <code className="tpl__ppath tpl__ppath--dim">
                        {previewFullPath(SPARSE_SONG, draft.folderTemplate, draft.songsDir)}
                      </code>
                    </div>
                  ) : null}
                </div>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.autoTargetFolder}
                    onChange={(e) => setDraft({ ...draft, autoTargetFolder: e.target.checked })}
                  />
                  <span>Skip the folder picker and use this template</span>
                </label>

                <p className="field__hint">
                  Use <code>/</code> for subfolders, so <code>{'{genre}/{artist}/{artist} - {title}'}</code>{' '}
                  sorts your library automatically. A subfolder whose tags are all empty is skipped
                  rather than named "Unknown", and <code>{'{name}'}</code> works as an alias for{' '}
                  <code>{'{title}'}</code>. Leave the checkbox off to keep picking a folder each time,
                  with the template still naming the chart folder. Song packs keep their original
                  folder names.
                </p>
              </div>
            </div>
          </fieldset>

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

          <fieldset className="field">
            <span>
              UI scale
              <span
                className="info"
                title="Make the whole interface bigger or smaller. This stacks on top of your Windows display scaling, so it's handy on very high-resolution (4K) screens where things can look small."
              >
                <Icon name="info" size={13} />
              </span>
            </span>
            <div className="scaler">
              <button
                type="button"
                className="scaler__btn"
                onClick={() => setScale((draft.uiScale ?? 1) - 0.1)}
                disabled={(draft.uiScale ?? 1) <= 0.7}
                aria-label="Smaller"
              >
                −
              </button>
              <span className="scaler__val">{Math.round((draft.uiScale ?? 1) * 100)}%</span>
              <button
                type="button"
                className="scaler__btn"
                onClick={() => setScale((draft.uiScale ?? 1) + 0.1)}
                disabled={(draft.uiScale ?? 1) >= 1.6}
                aria-label="Bigger"
              >
                +
              </button>
              <button
                type="button"
                className="linkbtn scaler__reset"
                onClick={() => setScale(1)}
                disabled={(draft.uiScale ?? 1) === 1}
              >
                Reset
              </button>
            </div>
            <p className="field__hint">
              Stacks on top of Windows display scaling. Preview updates live; click Save to keep it.
            </p>
          </fieldset>
        </div>

        <div className="modal__foot">
          <button className="btn-secondary" onClick={cancelSettings}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={async () => {
              // Pojistka: „Results per page" srovnej do 5–100 (min/max u inputu jsou
              // jen nápověda, ruční zápis je obejde).
              const clean: AppConfig = {
                ...draft,
                recordsPerPage: Math.min(100, Math.max(5, Number(draft.recordsPerPage) || 25))
              }
              await saveConfig(clean)
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
