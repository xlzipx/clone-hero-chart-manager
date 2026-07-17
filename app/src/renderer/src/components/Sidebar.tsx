import { useEffect, useState } from 'react'
import type { Database, RhythmVerseSystem, UpdateAvailable } from '../../../shared/types'
import chLogo from '../assets/CloneHero_Logo.png'
import spotifyMark from '../assets/Spotify_Primary_Logo.webp'
import yargLogo from '../assets/YARG_Logo.png'
import { useStore } from '../store'
import { Icon } from './Icon'

// Verzi, kterou uživatel „zavřel", si pamatujeme, ať ho stejné upozornění neotravuje.
const DISMISS_KEY = 'chm.updateDismissed'

// Levý panel (redesign v2 dle mockupu): nahoře launchery her S IKONAMI,
// pod nimi svislé seznamy DATABASE a SYSTEM. Stejné chování jako dřívější
// Segmented přepínače v SearchBaru — jen jiné rozložení.

type Game = 'clone-hero' | 'yarg' | null

const DATABASES: { id: Database; label: string; hint: string }[] = [
  { id: 'rhythmverse', label: 'RhythmVerse', hint: 'Largest catalogue — CH, Phase Shift and Rock Band CON' },
  { id: 'enchor', label: 'Chorus Encore', hint: 'Curated Clone Hero charts hosted directly as .sng files' },
  { id: 'both', label: 'Both', hint: 'Merged & de-duplicated results from both sources' }
]

const SYSTEMS: { id: RhythmVerseSystem; label: string; hint: string }[] = [
  { id: 'ch', label: 'Clone Hero', hint: 'Native charts (no conversion)' },
  { id: 'ps', label: 'Phase Shift', hint: 'Read by Clone Hero directly' },
  { id: 'rb3', label: 'Rock Band', hint: 'CON → converted to CH' },
  { id: 'all', label: 'All', hint: 'All formats' }
]

function gameName(g: Exclude<Game, null>): string {
  return g === 'yarg' ? 'YARG' : 'Clone Hero'
}

export function Sidebar(): JSX.Element {
  const database = useStore((s) => s.database)
  const setDatabase = useStore((s) => s.setDatabase)
  const system = useStore((s) => s.system)
  const setSystem = useStore((s) => s.setSystem)
  const query = useStore((s) => s.query)
  const doSearch = useStore((s) => s.doSearch)
  const surpriseMe = useStore((s) => s.surpriseMe)
  const setShowPlaylistImport = useStore((s) => s.setShowPlaylistImport)

  // Launch / focus her — přesunuto z TitleBaru, logika beze změny.
  const [runningGame, setRunningGame] = useState<Game>(null)
  const [busy, setBusy] = useState(false)

  // Lze hru spustit? (exe z config override nebo auto-detekce). path === null →
  // exe nenalezené → launcher označíme jako „nelze spustit" a klik pošle do Nastavení.
  const config = useStore((s) => s.config)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const [chOk, setChOk] = useState(true)
  const [yargOk, setYargOk] = useState(true)
  useEffect(() => {
    void window.api.chExeStatus().then((s) => setChOk(s.path !== null))
    void window.api.yargExeStatus().then((s) => setYargOk(s.path !== null))
  }, [config?.chExePath, config?.yargExePath, config?.songsDir])

  // Verze + celý životní cyklus aktualizace (přesunuto sem z horního pruhu):
  // ruční kontrola → dostupné → stahování → připraveno k restartu.
  const [version, setVersion] = useState('')
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'uptodate' | 'error'>('idle')
  const [available, setAvailable] = useState<UpdateAvailable | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  useEffect(() => {
    void window.api.runningGame().then(setRunningGame)
    void window.api.appVersion().then(setVersion)
    const offGame = window.api.onGameStatus(setRunningGame)
    const offAvail = window.api.onUpdateAvailable((i) => {
      if (localStorage.getItem(DISMISS_KEY) === i.version) return // tuhle verzi už zavřel
      setAvailable(i)
    })
    const offProg = window.api.onUpdateProgress((p) => setPercent(p.percent))
    const offDone = window.api.onUpdateDownloaded(() => {
      setDownloaded(true)
      setDownloading(false)
    })
    return () => {
      offGame()
      offAvail()
      offProg()
      offDone()
    }
  }, [])

  // Výsledek ruční kontroly („na latest verzi" / „nešlo zkontrolovat") sám zmizí
  // po pár sekundách — jinak by visel až do restartu aplikace.
  useEffect(() => {
    if (checkState !== 'uptodate' && checkState !== 'error') return undefined
    const id = setTimeout(() => setCheckState('idle'), 4000)
    return () => clearTimeout(id)
  }, [checkState])

  const checkUpdates = async (): Promise<void> => {
    setCheckState('checking')
    try {
      const res = await window.api.checkForUpdates()
      if (res.status === 'available' && res.version) {
        setAvailable({
          version: res.version,
          canAutoUpdate: res.canAutoUpdate ?? false,
          url: res.url
        })
        setCheckState('idle')
      } else {
        setCheckState(res.status === 'uptodate' ? 'uptodate' : 'error')
      }
    } catch {
      setCheckState('error')
    }
  }

  const dismissUpdate = (): void => {
    if (available) localStorage.setItem(DISMISS_KEY, available.version)
    setAvailable(null)
  }

  const downloadUpdate = async (): Promise<void> => {
    setDownloading(true)
    setPercent(0)
    try {
      const res = await window.api.downloadUpdate()
      if (!res.ok) {
        setDownloading(false)
        setPercent(null)
        window.alert(`Update download failed: ${res.error}`)
      }
    } catch (e) {
      setDownloading(false)
      setPercent(null)
      window.alert(`Update download failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const launchGame = async (game: Exclude<Game, null>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await window.api.bringGameToFront(game)
      if (!res.ok) {
        window.alert(res.error)
      } else if (!runningGame && res.game) {
        setRunningGame(res.game)
      }
    } finally {
      setBusy(false)
    }
  }

  const launcher = (game: Exclude<Game, null>, logo: string): JSX.Element => {
    const isRunning = runningGame === game
    const launchable = game === 'clone-hero' ? chOk : yargOk
    // „Nelze spustit" jen když hra NEběží (běžící se dá přepnout i bez exe cesty).
    const missing = !isRunning && !launchable
    const label = busy ? 'Working…' : isRunning ? `Switch to ${gameName(game)}` : `Launch ${gameName(game)}`
    const title = missing
      ? `${gameName(game)} executable not found — click to set its path in Settings`
      : isRunning
        ? `${gameName(game)} is running — click to bring it to the front`
        : label
    return (
      <button
        className={`side-launch side-launch--${game} ${isRunning ? 'side-launch--running' : ''} ${
          missing ? 'side-launch--missing' : ''
        }`}
        title={missing ? title : undefined}
        onClick={() => (missing ? setShowSettings(true) : void launchGame(game))}
        disabled={busy}
      >
        <img className="side-launch__logo" src={logo} alt="" draggable={false} />
        <span>{label}</span>
        {missing ? (
          <span className="side-launch__warn" aria-label="Executable not found">
            <Icon name="info" size={14} />
          </span>
        ) : null}
      </button>
    )
  }

  const showSystems = database !== 'enchor'

  return (
    <aside className="sidebar">
      <div className="side-launchers">
        {launcher('clone-hero', chLogo)}
        {launcher('yarg', yargLogo)}
      </div>

      <div className="side-group">
        <div className="side-label">Database</div>
        <div className="side-list">
          {/* Klouzavé zvýraznění — plavně sjede na aktivní položku (index × 60 px:
              výška 52 + mezera 8). */}
          <span
            className="side-indicator"
            aria-hidden="true"
            style={{ transform: `translateY(${DATABASES.findIndex((d) => d.id === database) * 60}px)` }}
          />
          {DATABASES.map((d) => (
            <button
              key={d.id}
              type="button"
              title={d.hint}
              className={`side-item ${database === d.id ? 'side-item--on' : ''}`}
              onClick={() => {
                setDatabase(d.id)
                // Vždy re-search: prázdný dotaz výsledky vyčistí (RV/Both)
                // nebo přepne na browse-all (Encore) — žádné zatuchlé výsledky.
                void doSearch(1)
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {showSystems ? (
        <div className="side-group">
          <div className="side-label">System</div>
          <div className="side-list">
            <span
              className="side-indicator"
              aria-hidden="true"
              style={{ transform: `translateY(${SYSTEMS.findIndex((s) => s.id === system) * 60}px)` }}
            />
            {SYSTEMS.map((sys) => (
              <button
                key={sys.id}
                type="button"
                title={sys.hint}
                className={`side-item ${system === sys.id ? 'side-item--on' : ''}`}
                onClick={() => {
                  setSystem(sys.id)
                  // Re-search i v browse režimu (prázdný dotaz), ne jen u textu.
                  void doSearch(1)
                }}
              >
                {sys.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Akční tlačítka pod seznamy. „Surprise me" = náhodný chart (respektuje
          dotaz i filtry). „Import playlist" = dohledat charty z odkazu na playlist. */}
      <div className="side-actions">
        <button type="button" className="side-surprise" onClick={() => surpriseMe()}>
          <Icon name="dice" size={18} className="side-surprise__dice" />
          <span className="side-surprise__text">
            <span className="side-surprise__title">Surprise me</span>
            <span className="side-surprise__sub">Discover 5 random charts</span>
          </span>
        </button>

        <button
          type="button"
          className="side-surprise side-import"
          onClick={() => setShowPlaylistImport(true)}
        >
          <span
            className="side-import__logo"
            style={{ WebkitMaskImage: `url(${spotifyMark})`, maskImage: `url(${spotifyMark})` }}
            aria-hidden="true"
          />
          <span className="side-surprise__text">
            <span className="side-surprise__title">Import playlist</span>
            <span className="side-surprise__sub">Turn a playlist into charts</span>
          </span>
        </button>
      </div>

      <div className="side-footer">
        {downloaded && available ? (
          // Staženo → stačí restart. Zelený „ready" nádech + obíhající okraj.
          <div className="side-update-card side-update-card--ready side-update-card--live">
            <div className="side-update-card__title">Update ready</div>
            <div className="side-update-card__desc">
              v{available.version} downloaded. Restart to install it.
            </div>
            <button
              type="button"
              className="side-update-card__btn"
              onClick={() => void window.api.installUpdate()}
            >
              Restart &amp; install
            </button>
          </div>
        ) : downloading ? (
          // Stahování na pozadí → průběh.
          <div className="side-update-card">
            <div className="side-update-card__title">Downloading update</div>
            <div className="side-update-card__desc">
              v{available?.version} · {percent ?? 0}%
            </div>
            <div className="side-update-progress">
              <div className="side-update-progress__fill" style={{ width: `${percent ?? 0}%` }} />
            </div>
          </div>
        ) : available ? (
          // Dostupná nová verze → výrazné upozornění s obíhajícím okrajem.
          <div className="side-update-card side-update-card--live">
            <button
              type="button"
              className="side-update-card__close"
              onClick={dismissUpdate}
              title="Dismiss"
            >
              <Icon name="close" size={12} />
            </button>
            <div className="side-update-card__title">Update available</div>
            <div className="side-update-card__desc">
              Version {available.version} is ready to install.
            </div>
            {available.canAutoUpdate ? (
              <button
                type="button"
                className="side-update-card__btn"
                onClick={() => void downloadUpdate()}
              >
                Download update
              </button>
            ) : (
              <button
                type="button"
                className="side-update-card__btn"
                onClick={() => available.url && window.api.openExternal(available.url)}
              >
                View release
              </button>
            )}
          </div>
        ) : (
          // Klidový stav → verze + ruční kontrola.
          <>
            <span className="side-version">version {version || '…'}</span>
            <button
              type="button"
              className="side-update"
              onClick={() => void checkUpdates()}
              disabled={checkState === 'checking'}
            >
              {checkState === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
            {checkState === 'uptodate' ? (
              <span className="side-update__result side-update__result--uptodate">
                You&apos;re on the latest version.
              </span>
            ) : checkState === 'error' ? (
              <span className="side-update__result side-update__result--error">
                Couldn&apos;t check right now.
              </span>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
