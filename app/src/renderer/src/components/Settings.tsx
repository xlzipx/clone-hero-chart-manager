import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_FOLDER_TEMPLATE,
  FOLDER_TAGS,
  previewFolderPath,
  type FolderTagSource
} from '../../../shared/foldertemplate'
import type { AppConfig, ReminderPosition } from '../../../shared/types'
import { useStore } from '../store'
import { IS_LINUX, IS_MAC } from '../platform'
import { HotkeyInput } from './HotkeyInput'
import { UpdateNotes } from './UpdateNotes'
import { Icon, type IconName } from './Icon'

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

type SectionId = 'library' | 'downloads' | 'interface' | 'overlay' | 'updates' | 'maintenance'

/** Kategorie Nastavení. Barva = barva nástroje, stejná „řeč" jako zbytek appky. */
const SECTIONS: { id: SectionId; label: string; icon: IconName; hint: string; desc: string; color: string }[] = [
  {
    id: 'library',
    label: 'Library & paths',
    icon: 'folder',
    hint: 'Songs folder, game paths',
    desc: 'Where your charts live and where Clone Hero and YARG are installed.',
    color: '#ff5b5b'
  },
  {
    id: 'downloads',
    label: 'Downloads',
    icon: 'download',
    hint: 'Folder names, format, queue',
    desc: 'How downloaded charts are named, saved and queued.',
    color: '#4a90e2'
  },
  {
    id: 'interface',
    label: 'Search & interface',
    icon: 'search',
    hint: 'Results, scale, tips',
    desc: 'Search results and the size of the whole interface.',
    color: '#f5c518'
  },
  {
    id: 'overlay',
    label: 'Game overlay',
    icon: 'gamepad',
    hint: 'Reminder, hotkey',
    desc: 'Getting back to Chart Manager while a game is running.',
    color: '#d23bd2'
  },
  {
    id: 'updates',
    label: 'Updates',
    icon: 'refresh',
    hint: 'New versions',
    desc: 'Keep Chart Manager up to date.',
    color: '#2dd4bf'
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: 'settings',
    hint: 'Catalog, cache, backup',
    desc: 'Local catalog, cached files and a backup of your settings.',
    color: '#cfd0d6'
  }
]

// Poslední otevřená kategorie (mezi otevřeními Nastavení během běhu appky).
let lastSection: SectionId = 'library'

/**
 * Textové pole, které se uloží až po opuštění (blur) nebo Enteru. Cesty a
 * šablona se tak neukládají po každém písmenu (rozepsaná cesta by na chvíli
 * přepnula knihovnu na neexistující složku).
 */
function CommitInput({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>): JSX.Element {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = (): void => {
    if (v !== value) onCommit(v)
  }
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          e.stopPropagation()
          setV(value)
        }
      }}
    />
  )
}

/** Přepínač (místo checkboxu) — zapnutý svítí barvou kategorie. */
function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`stsw ${checked ? 'stsw--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="stsw__knob" />
    </button>
  )
}

/** Posuvník hlasitosti ukázek: mění se hned, uloží se po chvíli klidu. */
function PreviewVolume({ value, onSave }: { value: number; onSave: (v: number) => void }): JSX.Element {
  const [v, setV] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const change = (next: number): void => {
    setV(next)
    useStore.getState().applyPreviewVolume(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onSave(next), 300)
  }
  return (
    <div className="stvol">
      <input
        className="player__volslider stvol__slider"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        onChange={(e) => change(Number(e.target.value))}
        style={{ '--v': `${v * 100}%` } as React.CSSProperties}
        aria-label="Preview volume"
      />
      <span className="stvol__val">{Math.round(v * 100)}%</span>
    </div>
  )
}

/** Jeden řádek nastavení: vlevo název + popis, vpravo ovládání. */
function Row({
  title,
  desc,
  children,
  stack
}: {
  title: React.ReactNode
  desc?: React.ReactNode
  children?: React.ReactNode
  /** Ovládání pod textem přes celou šířku (cesty, šablona). */
  stack?: boolean
}): JSX.Element {
  return (
    <div className={`strow ${stack ? 'strow--stack' : ''}`}>
      <div className="strow__text">
        <div className="strow__title">{title}</div>
        {desc ? <div className="strow__desc">{desc}</div> : null}
      </div>
      {children ? <div className="strow__ctl">{children}</div> : null}
    </div>
  )
}

function Card({ title, children }: { title?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="stcard">
      {title ? <h3 className="stcard__title">{title}</h3> : null}
      <div className="stcard__rows">{children}</div>
    </section>
  )
}

function Seg<T extends string | number>({
  value,
  options,
  onChange
}: {
  value: T
  options: { v: T; l: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} type="button" className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Pole s cestou: ikona složky, stav (nalezeno / chybí) a tlačítko Browse. */
function PathField({
  value,
  placeholder,
  status,
  onCommit,
  onBrowse,
  onDetect,
  detecting,
  note
}: {
  value: string
  placeholder?: string
  status?: { ok: boolean; text: string } | null
  onCommit: (v: string) => void
  onBrowse: () => void
  /** Volitelné tlačítko „Detect" (hry): znovu najít automaticky. */
  onDetect?: () => void
  detecting?: boolean
  /** Výsledek posledního „Detect" pod polem. */
  note?: { ok: boolean; text: string } | null
}): JSX.Element {
  return (
    <>
    <div className="stpath">
      <div className="stpath__box">
        <Icon name="folder" size={15} />
        <CommitInput value={value} placeholder={placeholder} spellCheck={false} onCommit={onCommit} />
        {status ? (
          <span className={`stpath__status ${status.ok ? 'is-ok' : 'is-bad'}`}>
            {status.ok ? <Icon name="check" size={11} /> : null} {status.text}
          </span>
        ) : null}
      </div>
      {onDetect ? (
        <button
          type="button"
          className="btn-secondary stpath__browse"
          onClick={onDetect}
          disabled={detecting}
          title="Look for the game again in the usual places and launcher records"
        >
          {detecting ? 'Detecting…' : 'Detect'}
        </button>
      ) : null}
      <button type="button" className="btn-secondary stpath__browse" onClick={onBrowse}>
        Browse…
      </button>
    </div>
    {note ? <p className={`stpath__note ${note.ok ? 'is-ok' : 'is-bad'}`}>{note.text}</p> : null}
    </>
  )
}

/**
 * Nastavení na celou obrazovku (jako Library): vlevo kategorie, vpravo jejich
 * volby. Všechno se ukládá hned — žádné Save / Cancel.
 */
export function Settings(): JSX.Element | null {
  const config = useStore((s) => s.config)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const saveConfig = useStore((s) => s.saveConfig)
  const loadConfig = useStore((s) => s.loadConfig)
  const catalog = useStore((s) => s.catalogStatus)
  const [section, setSection] = useState<SectionId>(lastSection)
  const [exeStatus, setExeStatus] = useState<{ path: string | null; autoDetected: boolean } | null>(null)
  const [yargStatus, setYargStatus] = useState<{ path: string | null; autoDetected: boolean } | null>(null)
  const [songsOk, setSongsOk] = useState<boolean | null>(null)
  const [detecting, setDetecting] = useState<'clone-hero' | 'yarg' | null>(null)
  const [detectNote, setDetectNote] = useState<{ game: 'clone-hero' | 'yarg'; ok: boolean; text: string } | null>(null)
  const [version, setVersion] = useState('')
  const [updateMsg, setUpdateMsg] = useState<{ text: string; url?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    lastSection = section
    if (section === 'maintenance') void window.api.cacheSize().then(setCacheBytes)
  }, [section])

  useEffect(() => {
    void window.api.appVersion().then(setVersion)
  }, [])

  useEffect(() => {
    if (!config) return
    void window.api.chExeStatus().then(setExeStatus)
    void window.api.yargExeStatus().then(setYargStatus)
    void window.api.songsDirExists().then(setSongsOk)
  }, [config?.songsDir, config?.chExePath, config?.yargExePath])

  // „Detect": najít hru znovu automaticky. Nalezeno → ruční cesta pryč (pole
  // přejde na Auto-detected); nenalezeno → ruční cesta zůstává beze změny.
  const detectGame = async (game: 'clone-hero' | 'yarg'): Promise<void> => {
    if (!config) return
    // „Detecting…" až když hledání trvá znatelně dlouho (registry, pomalý disk);
    // běžně je hotovo za pár ms a přepnutí popisku by jen problikl. Stará zpráva
    // pod polem zůstává, dokud nepřijde nová — řádek neposkočí.
    const slow = window.setTimeout(() => setDetecting(game), 300)
    const found = await window.api.redetectGame(game).catch(() => null)
    window.clearTimeout(slow)
    setDetecting(null)
    const name = game === 'clone-hero' ? 'Clone Hero' : 'YARG'
    if (!found) {
      setDetectNote({ game, ok: false, text: `Couldn't find ${name} automatically. Use Browse… to pick it.` })
      return
    }
    const key = game === 'clone-hero' ? 'chExePath' : 'yargExePath'
    if (config[key]) set({ [key]: '' })
    else if (game === 'clone-hero') void window.api.chExeStatus().then(setExeStatus)
    else void window.api.yargExeStatus().then(setYargStatus)
    setDetectNote({ game, ok: true, text: `Found ${name}: ${found}` })
  }

  // Poprvé bez složky Songs → rovnou na Library & paths.
  useEffect(() => {
    if (songsOk === false) setSection('library')
  }, [songsOk])

  const flash = (msg: string): void => {
    setNotice(msg)
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3500)
  }

  if (!config) return null
  const set = (patch: Partial<AppConfig>): void => void saveConfig(patch)

  const setScale = (next: number): void => {
    const clamped = Math.min(1.6, Math.max(0.7, Math.round(next * 10) / 10))
    void window.api.setUiScale(clamped)
    set({ uiScale: clamped })
  }

  const checkUpdates = async (): Promise<void> => {
    setChecking(true)
    setUpdateMsg(null)
    try {
      const res = await window.api.checkForUpdates()
      if (res.status === 'available' && res.version) {
        setUpdateMsg({
          text: `Version ${res.version} is available. Use the update notice in the bottom-left corner to install it.`,
          url: res.url
        })
      } else if (res.status === 'uptodate') setUpdateMsg({ text: 'You have the latest version.' })
      else setUpdateMsg({ text: 'Could not check for updates right now. Try again later.' })
    } catch {
      setUpdateMsg({ text: 'Could not check for updates right now. Try again later.' })
    }
    setChecking(false)
  }

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const lastSync = catalog?.lastSync
    ? new Date(catalog.lastSync).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never'
  const exePlaceholder = (auto: typeof exeStatus, mac: string, linux: string, win: string): string =>
    auto?.autoDetected && auto.path ? `Using: ${auto.path}` : IS_MAC ? mac : IS_LINUX ? linux : win

  return (
    <div className="stv" style={{ '--sc': current.color } as React.CSSProperties}>
      <aside className="stv__nav" aria-label="Settings sections">
        <div className="stv__navhead">
          <Icon name="settings" size={14} /> Settings
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`stv__navitem ${section === s.id ? 'stv__navitem--on' : ''}`}
            style={{ '--ic': s.color } as React.CSSProperties}
            onClick={() => setSection(s.id)}
          >
            <span className="stv__navicon">
              <Icon name={s.icon} size={15} />
            </span>
            <span className="stv__navtext">
              <span>{s.label}</span>
              <small>{s.hint}</small>
            </span>
            {s.id === 'library' && songsOk === false ? <span className="stv__dot" title="Needs attention" /> : null}
          </button>
        ))}
        <div className="stv__navfoot">
          <span className="stv__saved">
            <Icon name="check" size={11} /> Changes save automatically
          </span>
          <button type="button" className="btn-primary" onClick={() => setShowSettings(false)}>
            Done
          </button>
        </div>
      </aside>

      <section className="stv__main" aria-label={current.label}>
        <header className="stv__head" key={section}>
          <span className="stv__headicon">
            <Icon name={current.icon} size={22} />
          </span>
          <div className="stv__headtext">
            <h2>{current.label}</h2>
            <p>{current.desc}</p>
          </div>
          {notice ? (
            <span className="stv__notice">
              <Icon name="check" size={12} /> {notice}
            </span>
          ) : null}
        </header>

        <div className="stv__body" key={`b-${section}`}>
          {section === 'library' ? (
            <>
              {songsOk === false ? (
                <div className="stv__banner">
                  <Icon name="info" size={16} />
                  <span>
                    Pick your Clone Hero <strong>Songs</strong> folder to get started. Downloaded charts go
                    there and My Library shows what's inside.
                  </span>
                </div>
              ) : null}
              <Card title="Songs library">
                <Row
                  stack
                  title="Songs folder"
                  desc="Your Clone Hero Songs folder. Downloads are installed here and My Library shows its contents."
                >
                  <PathField
                    value={config.songsDir}
                    status={songsOk === false ? { ok: false, text: 'Not found' } : null}
                    onCommit={(v) => set({ songsDir: v })}
                    onBrowse={async () => {
                      const dir = await window.api.chooseDirectory()
                      if (dir) set({ songsDir: dir })
                    }}
                  />
                </Row>
              </Card>
              <Card title="Games">
                <Row
                  stack
                  title={IS_MAC ? 'Clone Hero app' : 'Clone Hero'}
                  desc={
                    <>
                      Used by the <strong>Launch Clone Hero</strong> button. Leave empty to detect it
                      automatically.
                    </>
                  }
                >
                  <PathField
                    value={config.chExePath}
                    placeholder={exePlaceholder(
                      exeStatus,
                      'e.g. /Applications/Clone Hero.app',
                      'e.g. ~/.clonehero/CloneHero.x86_64',
                      'e.g. C:\\Games\\Clone Hero\\Clone Hero.exe'
                    )}
                    status={
                      config.chExePath
                        ? null
                        : exeStatus?.path
                          ? { ok: true, text: 'Auto-detected' }
                          : exeStatus
                            ? { ok: false, text: 'Not detected' }
                            : null
                    }
                    onCommit={(v) => set({ chExePath: v })}
                    onBrowse={async () => {
                      const f = await window.api.chooseExeFile()
                      if (f) set({ chExePath: f })
                    }}
                    onDetect={() => void detectGame('clone-hero')}
                    detecting={detecting === 'clone-hero'}
                    note={detectNote?.game === 'clone-hero' ? detectNote : null}
                  />
                </Row>
                <Row
                  stack
                  title={IS_MAC ? 'YARG app' : 'YARG'}
                  desc="Lets the overlay and hotkey find YARG. YARG reads the same Songs folder, no separate library needed."
                >
                  <PathField
                    value={config.yargExePath}
                    placeholder={exePlaceholder(
                      yargStatus,
                      'e.g. /Applications/YARG.app',
                      'e.g. ~/YARG/YARG.x86_64',
                      'e.g. C:\\YARG\\Content\\YARG Installs\\<GUID>\\installation\\YARG.exe'
                    )}
                    status={
                      config.yargExePath
                        ? null
                        : yargStatus?.path
                          ? { ok: true, text: 'Auto-detected' }
                          : yargStatus
                            ? { ok: false, text: 'Not detected' }
                            : null
                    }
                    onCommit={(v) => set({ yargExePath: v })}
                    onBrowse={async () => {
                      const f = await window.api.chooseExeFile()
                      if (f) set({ yargExePath: f })
                    }}
                    onDetect={() => void detectGame('yarg')}
                    detecting={detecting === 'yarg'}
                    note={detectNote?.game === 'yarg' ? detectNote : null}
                  />
                </Row>
              </Card>
              <Card title="Deleting">
                <Row
                  title="Deleted songs and folders"
                  desc={
                    config.deleteMode === 'permanent'
                      ? 'Deleted right away and for good. They can’t be restored, so double-check before you delete.'
                      : `Go to the ${IS_MAC ? 'Trash' : 'Recycle Bin'}, so you can restore them if you change your mind.`
                  }
                >
                  <Seg
                    value={config.deleteMode ?? 'trash'}
                    options={[
                      { v: 'trash', l: IS_MAC ? 'Move to Trash' : 'Move to Recycle Bin' },
                      { v: 'permanent', l: 'Delete permanently' }
                    ]}
                    onChange={(v) => set({ deleteMode: v })}
                  />
                </Row>
              </Card>
            </>
          ) : null}

          {section === 'downloads' ? (
            <>
              <Card title="Chart folder name">
                <Row
                  stack
                  title="Folder name template"
                  desc={
                    <>
                      Use <code>/</code> for subfolders, e.g. <code>{'{genre}/{artist}/{artist} - {title}'}</code>.
                      Empty tags are skipped instead of becoming "Unknown". Song packs keep their own names.
                    </>
                  }
                >
                  <div className="sttpl">
                    <div className="sttpl__line">
                      <CommitInput
                        className="sttpl__input"
                        value={config.folderTemplate}
                        spellCheck={false}
                        placeholder={DEFAULT_FOLDER_TEMPLATE}
                        onCommit={(v) => set({ folderTemplate: v })}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => set({ folderTemplate: DEFAULT_FOLDER_TEMPLATE })}
                        disabled={config.folderTemplate === DEFAULT_FOLDER_TEMPLATE}
                        title="Reset to the default template"
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
                          onClick={() => set({ folderTemplate: `${config.folderTemplate}{${t}}` })}
                        >
                          {`{${t}}`}
                        </button>
                      ))}
                    </div>
                    <div className="sttpl__preview">
                      <span>Preview</span>
                      <code>{previewFullPath(SAMPLE_SONG, config.folderTemplate, config.songsDir)}</code>
                      {DROPPABLE_TAG_RE.test(config.folderTemplate) ? (
                        <>
                          <span title="Not every chart has a genre, year, album or charter filled in.">Tags empty</span>
                          <code className="is-dim">
                            {previewFullPath(SPARSE_SONG, config.folderTemplate, config.songsDir)}
                          </code>
                        </>
                      ) : null}
                    </div>
                  </div>
                </Row>
                <Row
                  title="Skip the folder picker"
                  desc="Install straight into the folder from the template instead of asking where to save each time."
                >
                  <Switch
                    label="Skip the folder picker"
                    checked={config.autoTargetFolder}
                    onChange={(v) => set({ autoTargetFolder: v })}
                  />
                </Row>
              </Card>

              <Card title="Download format">
                <Row
                  title="Chorus Encore charts"
                  desc={
                    <>
                      <em className="field__rec">Song folder recommended</em> — works everywhere, like the .zip on
                      Chorus Encore. A single .sng file is read by Clone Hero v1+ and YARG. RhythmVerse Clone Hero
                      charts are always saved as song folders.
                    </>
                  }
                >
                  <Seg
                    value={config.encoreFormat === 'sng' ? 'sng' : 'folder'}
                    options={[
                      { v: 'folder', l: 'Song folder' },
                      { v: 'sng', l: '.sng file' }
                    ]}
                    onChange={(v) => set({ encoreFormat: v })}
                  />
                </Row>
                <Row
                  title="Converter"
                  desc={
                    <>
                      <em className="field__rec">On recommended</em> — Rock Band charts (Xbox 360 CON and RB3CON) become
                      Clone Hero song folders while they download. Turn it off to save the original file exactly as the
                      database has it, for example for Rock Band 3 on Xbox 360.
                    </>
                  }
                >
                  <Switch
                    label="Converter"
                    checked={config.rbFormat !== 'original'}
                    onChange={(v) => set({ rbFormat: v ? 'convert' : 'original' })}
                  />
                </Row>
                <Row
                  title="Download background videos"
                  desc="Videos can take a lot of space. When off they are left out of song folders (a .sng file keeps its video)."
                >
                  <Switch
                    label="Download background videos"
                    checked={config.downloadVideos !== false}
                    onChange={(v) => set({ downloadVideos: v })}
                  />
                </Row>
              </Card>

              <Card title="Download queue">
                <Row
                  title="Downloads at the same time"
                  desc="More at once finishes a big batch faster. Rock Band conversions are heavy, keep it low on older PCs."
                >
                  <Seg
                    value={config.maxConcurrentDownloads || 1}
                    options={[1, 2, 3, 4].map((n) => ({ v: n, l: String(n) }))}
                    onChange={(v) => set({ maxConcurrentDownloads: v })}
                  />
                </Row>
                <Row title="Clear finished downloads" desc="Finished downloads disappear from the queue after a few seconds.">
                  <Switch
                    label="Clear finished downloads"
                    checked={config.autoClearFinished !== false}
                    onChange={(v) => set({ autoClearFinished: v })}
                  />
                </Row>
              </Card>
            </>
          ) : null}

          {section === 'interface' ? (
            <Card title="Search & display">
              <Row title="Results per page" desc="How many charts one page of search results shows.">
                <Seg
                  value={config.recordsPerPage}
                  options={[25, 50, 75, 100].map((n) => ({ v: n, l: String(n) }))}
                  onChange={(v) => set({ recordsPerPage: v })}
                />
              </Row>
              <Row title="UI scale" desc="Makes the whole interface bigger or smaller, on top of your system display scaling.">
                <div className="scaler">
                  <button
                    type="button"
                    className="scaler__btn"
                    onClick={() => setScale((config.uiScale ?? 1) - 0.1)}
                    disabled={(config.uiScale ?? 1) <= 0.7}
                    aria-label="Smaller"
                  >
                    −
                  </button>
                  <span className="scaler__val">{Math.round((config.uiScale ?? 1) * 100)}%</span>
                  <button
                    type="button"
                    className="scaler__btn"
                    onClick={() => setScale((config.uiScale ?? 1) + 0.1)}
                    disabled={(config.uiScale ?? 1) >= 1.6}
                    aria-label="Bigger"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="linkbtn scaler__reset"
                    onClick={() => setScale(1)}
                    disabled={(config.uiScale ?? 1) === 1}
                  >
                    Reset
                  </button>
                </div>
              </Row>
              <Row title="Tips in the title bar" desc="Short rotating hints next to the title, like how to preview a song.">
                <Switch label="Tips in the title bar" checked={config.showTips !== false} onChange={(v) => set({ showTips: v })} />
              </Row>
              <Row title="Compact rows" desc="Shorter song rows in Search and My Library, so more songs fit on the screen.">
                <Switch label="Compact rows" checked={!!config.compactRows} onChange={(v) => set({ compactRows: v })} />
              </Row>
              <Row title="Reduce motion" desc="Turns off animations and transitions. Can help on slower computers.">
                <Switch label="Reduce motion" checked={!!config.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
              </Row>
              <Row title="Preview volume" desc="How loud song previews play.">
                <PreviewVolume value={config.previewVolume ?? 0.5} onSave={(v) => set({ previewVolume: v })} />
              </Row>
            </Card>
          ) : null}

          {section === 'overlay' ? (
            <Card title="While you play">
              <Row
                title="Hotkey reminder over the game"
                desc="A tiny pill in a corner of the screen for a few seconds when a game starts. Works over windowed and borderless games."
              >
                <Switch
                  label="Hotkey reminder over the game"
                  checked={config.showReminder}
                  onChange={(v) => set({ showReminder: v })}
                />
              </Row>
              {config.showReminder ? (
                <Row title="Overlay icon position" desc="Which corner of the screen the reminder appears in.">
                  <PositionPicker value={config.reminderPosition} onChange={(v) => set({ reminderPosition: v })} />
                </Row>
              ) : null}
              <Row
                stack
                title="Show / hide hotkey"
                desc={
                  <>
                    Optional global shortcut that brings the app forward even while a game has focus. Click the
                    field and press a key or combo, e.g. <code>F10</code> or{' '}
                    <code>{IS_MAC ? '⌘⇧H' : 'Ctrl+Shift+H'}</code>.
                  </>
                }
              >
                <div className="sthk">
                  <HotkeyInput
                    value={config.hotkeys.toggleOverlay}
                    onChange={(v) => set({ hotkeys: { ...config.hotkeys, toggleOverlay: v } })}
                  />
                </div>
              </Row>
            </Card>
          ) : null}

          {section === 'updates' ? (
            <Card>
              <div className="stver">
                <div>
                  <div className="stver__name">Chart Manager</div>
                  <div className="stver__num">Version {version}</div>
                </div>
                <div className="stver__btns">
                  <button className="btn-secondary" onClick={() => useStore.getState().openWhatsNew()}>
                    What's new
                  </button>
                  <button className="btn-primary" disabled={checking} onClick={() => void checkUpdates()}>
                    {checking ? 'Checking…' : 'Check now'}
                  </button>
                </div>
              </div>
              {updateMsg ? (
                <div className="stver__msg">
                  {updateMsg.text}{' '}
                  {updateMsg.url ? (
                    <button className="linkbtn" onClick={() => window.api.openExternal(updateMsg.url as string)}>
                      Open release page
                    </button>
                  ) : null}
                </div>
              ) : null}
              <Row title="Check for updates on startup" desc="A notice appears in the bottom-left corner when a new version is out.">
                <Switch
                  label="Check for updates on startup"
                  checked={config.autoCheckUpdates}
                  onChange={(v) => set({ autoCheckUpdates: v })}
                />
              </Row>
            </Card>
          ) : null}
          {section === 'updates' && version ? <UpdateNotes version={version} /> : null}

          {section === 'maintenance' ? (
            <>
              <Card title="Local catalog">
                <div className="ststats">
                  <div className="ststat">
                    <span>RhythmVerse</span>
                    <strong>{(catalog?.counts.rv ?? 0).toLocaleString('en-US')}</strong>
                    <small>charts</small>
                  </div>
                  <div className="ststat">
                    <span>Chorus Encore</span>
                    <strong>{(catalog?.counts.en ?? 0).toLocaleString('en-US')}</strong>
                    <small>charts</small>
                  </div>
                  <div className="ststat">
                    <span>Status</span>
                    <strong className="ststat__small">
                      {catalog?.state === 'syncing'
                        ? catalog.longRun
                          ? `Updating ${Math.round((catalog.progress ?? 0) * 100)}%`
                          : 'Checking for new charts…'
                        : catalog?.usable
                          ? 'Ready'
                          : 'Not built yet'}
                    </strong>
                    <small>Last update: {lastSync}</small>
                  </div>
                </div>
                <Row
                  title="Update the catalog"
                  desc="A local copy of both databases makes filters and browsing fast. It updates itself in the background."
                >
                  <div className="stbtns">
                    <button
                      className="btn-secondary"
                      disabled={catalog?.state === 'syncing'}
                      onClick={() => {
                        void window.api.catalogSyncNow()
                        flash('Checking the databases for new charts…')
                      }}
                    >
                      Update now
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={catalog?.state === 'syncing'}
                      title="Downloads the whole catalog again. Search keeps working meanwhile."
                      onClick={() => {
                        void window.api.catalogRefreshAll()
                        flash('Refreshing the whole catalog in the background…')
                      }}
                    >
                      Refresh everything
                    </button>
                  </div>
                </Row>
              </Card>

              <Card title="Storage">
                <Row
                  title="Cached files"
                  desc="Album art and song previews from search, kept so they load faster next time. Safe to clear, they download again when needed."
                >
                  <div className="stbtns">
                    <span className="stsize">{cacheBytes === null ? '…' : formatBytes(cacheBytes)}</span>
                    <button
                      className="btn-secondary"
                      disabled={clearing || !cacheBytes}
                      onClick={async () => {
                        setClearing(true)
                        const before = cacheBytes ?? 0
                        const after = await window.api.cacheClear()
                        setCacheBytes(after)
                        setClearing(false)
                        flash(`Cleared ${formatBytes(Math.max(0, before - after))} of cached files.`)
                      }}
                    >
                      {clearing ? 'Clearing…' : 'Clear cache'}
                    </button>
                  </div>
                </Row>
                <Row title="App data folder" desc="Settings, the local catalog and caches live here.">
                  <button className="btn-secondary" onClick={() => void window.api.openDataFolder()}>
                    Open folder
                  </button>
                </Row>
              </Card>

              <Card title="Settings backup">
                <Row
                  title="Back up or restore"
                  desc="Save your settings to a file and load them later or on another PC. Window size and position are not included."
                >
                  <div className="stbtns">
                    <button
                      className="btn-secondary"
                      onClick={async () => {
                        if (await window.api.settingsExport()) flash('Settings saved.')
                      }}
                    >
                      Back up…
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={async () => {
                        try {
                          if (await window.api.settingsImport()) {
                            await loadConfig()
                            void useStore.getState().loadOwnedKeys() // knihovna se mohla změnit
                            flash('Settings restored.')
                          }
                        } catch (e) {
                          flash(
                            e instanceof Error
                              ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
                              : 'Restore failed.'
                          )
                        }
                      }}
                    >
                      Restore…
                    </button>
                  </div>
                </Row>
                <Row
                  title="Reset all settings"
                  desc="Every setting goes back to its default. Only your folder and game paths stay as they are."
                >
                  <button
                    className="btn-secondary stdanger"
                    onClick={async () => {
                      if (await window.api.settingsReset()) {
                        await loadConfig()
                        flash('Settings reset to defaults.')
                      }
                    }}
                  >
                    Reset…
                  </button>
                </Row>
              </Card>
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}
