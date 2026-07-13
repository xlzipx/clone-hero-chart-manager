import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaylistResolveError, PlaylistTrack, SongResult } from '../../../shared/types'
import spotifyLogo from '../assets/Spotify_logo.webp'
import { useStore } from '../store'
import { detectManualHost, formatDownloads, formatLabel, isAutoDownloadable, songKey } from '../utils'
import { Icon } from './Icon'

// Import playlistu (v1): vlož odkaz na veřejný Spotify playlist → appka dohledá
// charty (RhythmVerse „all" + podle aktuální databáze), ukáže i více verzí a
// nabídne hromadné stažení. Ověřeno prototypem: hledat podle NÁZVU (ne
// „interpret + název") a interpreta dopárovat mezi výsledky.

type RowStatus = 'pending' | 'searching' | 'matched' | 'notfound'
type Phase = 'input' | 'loading' | 'matching' | 'done'

interface Row {
  track: PlaylistTrack
  status: RowStatus
  /** Nalezené charty (verze), řazené stažitelné-first, pak nativní, pak dle stažení. */
  charts: SongResult[]
  /** Index vybrané verze v `charts`. */
  chosen: number
  /** Zahrnout do stažení? */
  selected: boolean
}

const CONCURRENCY = 4
const RECORDS = 60

// Očisti název skladby od šumu (remaster/verze/feat…), jinak i existující chart vypadne.
const NOISE_RE =
  /\s*[-–]\s*[^-–]*\b(?:remaster(?:ed)?|mono|stereo|version|mix|edit|live|remix|deluxe|anniversary|single|album|acoustic|demo|radio|re-?recorded)\b.*$/i
function normTitle(t: string): string {
  return t
    .replace(NOISE_RE, '')
    .replace(/\s*\((?:feat|ft|with)\.?[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .trim()
}
// Srovnávací klíč: bez diakritiky, bez „the ", jen alfanum.
function keyOf(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
}
// Hlavní interpret (bez feat./doprovodu). Slovní oddělovače (feat/ft/x/with)
// MUSÍ mít kolem sebe mezeru — jinak „ft"/„feat" jako podřetězec zmrší jména
// typu „Daft Punk" → „Da" nebo „Kraftwerk" → „Kra".
function mainArtist(a: string): string {
  return a.split(/\s*,\s*|\s*&\s*|\s+(?:featuring|feat|ft|with|x)\.?\s+/i)[0]?.trim() || a
}

async function matchTrack(track: PlaylistTrack): Promise<SongResult[]> {
  const nt = normTitle(track.title)
  if (!nt) return []
  const db = useStore.getState().database
  let songs: SongResult[]
  try {
    // system 'all' = nejširší pokrytí chartů (CH + PS + RB), db respektuje volbu.
    // Fulltext hledá jen podle NÁZVU a je „fuzzy" — „Iris" chytne i „Osiris",
    // „Irish Blood", „Donnie Iris"… U krátkých/častých názvů to zaplaví okno
    // balastem a skutečnou písničku vytlačí za hranici (ověřeno: 262 výsledků
    // na „Iris", v relevanci jediný Goo Goo Dolls záznam = Official DLC). Proto
    // řadíme dotaz podle STAŽENÍ: populární verze reálné písně vyplavou do okna
    // a dopárování interpreta pak nabídne i stažitelné charty, ne jen ten nej.
    const resp = await window.api.search(nt, 1, RECORDS, 'all', db, undefined, 'downloads')
    songs = resp.songs
  } catch {
    return []
  }
  const wantT = keyOf(nt)
  const wantA = keyOf(mainArtist(track.artist))
  const hits = songs.filter((s) => {
    const st = keyOf(normTitle(s.title))
    const sa = keyOf(s.artist)
    const titleOk = st === wantT || (st.length > 3 && (st.includes(wantT) || wantT.includes(st)))
    const artistOk = !!wantA && (sa.includes(wantA) || wantA.includes(sa))
    return titleOk && artistOk
  })
  hits.sort((a, b) => {
    const da = (isAutoDownloadable(a) ? 0 : 1) - (isAutoDownloadable(b) ? 0 : 1)
    if (da !== 0) return da
    const nc = (a.needsConversion ? 1 : 0) - (b.needsConversion ? 1 : 0)
    if (nc !== 0) return nc
    return (b.downloads ?? 0) - (a.downloads ?? 0)
  })
  return hits
}

const ERROR_MSG: Record<PlaylistResolveError, string> = {
  'not-a-playlist': 'That does not look like a Spotify playlist link. Paste a link like open.spotify.com/playlist/…',
  'not-found': 'Playlist not found. Make sure the link is correct and the playlist is public.',
  empty: 'No tracks found. Private playlists can’t be read here — set it to public and try again.',
  network: 'Could not reach Spotify. Check your connection and try again.',
  parse: 'Spotify returned something unexpected. Try again in a moment.',
  unknown: 'Something went wrong. Try again.'
}

function chartLabel(c: SongResult): string {
  return formatLabel(c.gameFormat) + (c.needsConversion ? ' → CH' : '')
}

// Krátký štítek, PROČ chart nejde stáhnout automaticky (null = stažitelný sám).
// Google Drive sem NEpatří — ten appka stahuje bez ruční interakce.
function unavailableTag(c: SongResult): string | null {
  if (c.official) return 'Official DLC'
  const host = detectManualHost(c.source, c.downloadUrl || c.downloadPageUrl)
  if (host === 'Shortener') return 'Manual link'
  return host // 'MEGA' | 'Mediafire' | null
}

// Otevře nestažitelný chart v prohlížeči — obchod (DLC) nebo stránku hostitele
// (MEGA/Mediafire/shortener), odkud si ho uživatel stáhne ručně. Stejné pořadí
// URL jako v běžných výsledcích (SongRow).
function openChartExternal(c: SongResult): void {
  const url = c.official
    ? c.externalUrl || c.downloadPageUrl || c.downloadUrl
    : c.downloadPageUrl || c.downloadUrl || c.externalUrl
  if (url) window.api.openExternal(url)
}
function externalHint(c: SongResult): string {
  if (c.official) return 'Official DLC — open the store page in your browser'
  const host = unavailableTag(c) ?? 'an external host'
  return `Hosted on ${host} — open in your browser, then drop the file into the drop zone`
}

export function PlaylistImportModal(): JSX.Element | null {
  const show = useStore((s) => s.showPlaylistImport)
  const close = useStore((s) => s.setShowPlaylistImport)
  const openBatchDownload = useStore((s) => s.openBatchDownload)
  // Index „už mám v knihovně" (artist|title, plní se na startu appky). Podle něj
  // označíme skladby, které už uživatel má, ať zbytečně nestahuje duplikáty.
  const ownedKeys = useStore((s) => s.ownedKeys)
  const isOwned = useCallback(
    (c: SongResult | undefined): boolean => !!c && ownedKeys.has(songKey(c.artist, c.title)),
    [ownedKeys]
  )

  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('input')
  const [error, setError] = useState<string | null>(null)
  const [playlistName, setPlaylistName] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const runId = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const resetAll = useCallback(() => {
    runId.current++ // zruš případné běžící párování
    setUrl('')
    setPhase('input')
    setError(null)
    setPlaylistName('')
    setTruncated(false)
    setRows([])
    setExpanded(null)
  }, [])

  // Reset při zavření, autofocus při otevření.
  useEffect(() => {
    if (!show) resetAll()
  }, [show, resetAll])
  useEffect(() => {
    if (show && phase === 'input') inputRef.current?.focus()
  }, [show, phase])

  const patchRow = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const runMatching = async (tracks: PlaylistTrack[]): Promise<void> => {
    const mine = ++runId.current
    // Snapshot owned indexu pro celý běh (načtený na startu appky).
    const ownedSet = useStore.getState().ownedKeys
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++
        if (i >= tracks.length || runId.current !== mine) return
        patchRow(i, { status: 'searching' })
        const charts = await matchTrack(tracks[i])
        if (runId.current !== mine) return
        const best = charts[0]
        const owned = best ? ownedSet.has(songKey(best.artist, best.title)) : false
        patchRow(i, {
          status: charts.length ? 'matched' : 'notfound',
          charts,
          chosen: 0,
          // Auto-zaškrtnout jen když nejlepší verze jde stáhnout sama (charty
          // jsou řazené stažitelné-first) a píseň ještě NEMÁM v knihovně —
          // duplikáty tak nikdo omylem nestáhne. MEGA/Mediafire/DLC/owned
          // necháme nezaškrtnuté (ale přepnutelné ručně).
          selected: charts.length > 0 && isAutoDownloadable(best) && !owned
        })
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    if (runId.current === mine) setPhase('done')
  }

  const startImport = async (): Promise<void> => {
    const u = url.trim()
    if (!u) return
    const myRun = ++runId.current // zruší případné běžící párování + kotva proti reopenu
    setError(null)
    setExpanded(null)
    setPhase('loading')
    setRows([])
    let res
    try {
      res = await window.api.resolvePlaylist(u)
    } catch (e) {
      // Nejčastěji: běžící dev build ještě nemá nový IPC handler / preload
      // (main + preload se nehotreloadují — nutný restart `npm run dev`).
      console.error('[playlist import] resolvePlaylist failed:', e)
      if (runId.current === myRun) {
        setPhase('input')
        setError(ERROR_MSG.unknown)
      }
      return
    }
    // Modal se mezitím zavřel (a možná znovu otevřel) → zahoď starý příslib.
    if (runId.current !== myRun || !useStore.getState().showPlaylistImport) return
    if (!res.ok) {
      setPhase('input')
      setError(ERROR_MSG[res.error] ?? ERROR_MSG.unknown)
      return
    }
    setPlaylistName(res.name)
    setTruncated(res.truncated)
    setRows(res.tracks.map((track) => ({ track, status: 'pending', charts: [], chosen: 0, selected: false })))
    setPhase('matching')
    void runMatching(res.tracks)
  }

  if (!show) return null

  const matchedRows = rows.filter((r) => r.status === 'matched')
  const resolvedCount = rows.filter((r) => r.status === 'matched' || r.status === 'notfound').length
  const selectedCharts = matchedRows.filter((r) => r.selected).map((r) => r.charts[r.chosen]).filter(Boolean)
  const downloadable = selectedCharts.filter(isAutoDownloadable)
  // „Select all" i indikátor pracují jen se STAŽITELNÝMI shodami — nestažitelné
  // (MEGA/Mediafire/DLC) jdou jen ručně přes pill, ne dávkově, tak ať je select-all
  // neoznačuje (jinak by seděly v „N selected", ale nestáhly se).
  const downloadableRows = matchedRows.filter((r) => isAutoDownloadable(r.charts[r.chosen]))
  const allSelected = downloadableRows.length > 0 && downloadableRows.every((r) => r.selected)
  const isBusy = phase === 'loading' || phase === 'matching'

  const toggleSelectAll = (): void =>
    setRows((rs) =>
      rs.map((r) =>
        r.status === 'matched' && isAutoDownloadable(r.charts[r.chosen])
          ? { ...r, selected: !allSelected }
          : r
      )
    )

  const doDownload = (): void => {
    // Dvě skladby playlistu můžou dopárovat na tentýž chart → dedup podle key,
    // ať se stejný soubor nezařadí do fronty dvakrát.
    const uniq = Array.from(new Map(downloadable.map((c) => [c.key, c])).values())
    if (uniq.length === 0) return
    close(false)
    void openBatchDownload(uniq)
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false)
      }}
    >
      <div className="modal modal--playlist" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>
            <Icon name="playlist" size={18} /> Import playlist
          </h2>
          <button className="modal__close" onClick={() => close(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="modal__body plimport__body">
          {phase === 'input' || phase === 'loading' ? (
            <div className="plimport__intro">
              <span
                className="plimport__brand"
                style={{ WebkitMaskImage: `url(${spotifyLogo})`, maskImage: `url(${spotifyLogo})` }}
                role="img"
                aria-label="Spotify"
              />
              <p className="plimport__lead">
                Paste a public Spotify playlist link and we’ll find charts for its songs.
              </p>
              <div className="plimport__inputrow">
                <input
                  ref={inputRef}
                  className="plimport__input"
                  type="text"
                  placeholder="https://open.spotify.com/playlist/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void startImport()
                  }}
                  disabled={phase === 'loading'}
                  spellCheck={false}
                />
                <button
                  className="btn-primary"
                  onClick={() => void startImport()}
                  disabled={!url.trim() || phase === 'loading'}
                >
                  {phase === 'loading' ? (
                    <>
                      <span className="plimport__spin" /> Reading…
                    </>
                  ) : (
                    <>
                      <Icon name="search" size={14} /> Find charts
                    </>
                  )}
                </button>
              </div>
              {error ? <p className="plimport__error">{error}</p> : null}
              <p className="plimport__note">
                Works with public Spotify playlists. YouTube and Apple Music may come later.
              </p>
            </div>
          ) : (
            <>
              <div className="plimport__status">
                <div className="plimport__title">
                  <strong>{playlistName}</strong>
                  <span className="plimport__count">
                    {isBusy
                      ? `matching ${resolvedCount}/${rows.length}…`
                      : `${matchedRows.length} of ${rows.length} found`}
                  </span>
                </div>
                {downloadableRows.length > 0 ? (
                  <button className="plimport__selall" onClick={toggleSelectAll}>
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                ) : null}
              </div>

              {isBusy ? (
                <div className="plimport__progress">
                  <div
                    className="plimport__progress-fill"
                    style={{ width: `${rows.length ? (resolvedCount / rows.length) * 100 : 0}%` }}
                  />
                </div>
              ) : null}

              {truncated ? (
                <p className="plimport__warn">
                  <Icon name="info" size={13} /> Only part of this playlist could be loaded (
                  {rows.length} songs imported).
                </p>
              ) : null}

              <div className="plimport__list">
                {rows.map((r, i) => {
                  const chart = r.charts[r.chosen]
                  const dl = chart ? isAutoDownloadable(chart) : false
                  const owned = isOwned(chart)
                  return (
                    <div key={i} className={`plrow plrow--${r.status}`}>
                      <div className="plrow__lead">
                        {r.status === 'matched' ? (
                          dl ? (
                            <label className="chk" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={r.selected}
                                onChange={() => patchRow(i, { selected: !r.selected })}
                              />
                              <span className="chk__box">
                                <Icon name="check" size={12} />
                              </span>
                            </label>
                          ) : (
                            // Nestažitelná verze (MEGA/Mediafire/DLC) → disabled políčko.
                            <span className="chk chk--disabled" aria-hidden="true">
                              <span className="chk__box" />
                            </span>
                          )
                        ) : r.status === 'notfound' ? (
                          <span className="plrow__x">
                            <Icon name="close" size={12} />
                          </span>
                        ) : (
                          <span className="plimport__spin plrow__spin" />
                        )}
                      </div>

                      <div className="plrow__track">
                        <div className="plrow__title">{r.track.title}</div>
                        <div className="plrow__artist">{r.track.artist}</div>
                      </div>

                      <div className="plrow__match">
                        {r.status === 'matched' && chart ? (
                          <>
                            {owned ? (
                              <span
                                className="badge badge--owned plrow__owned"
                                title="You already have this song in your library"
                              >
                                <Icon name="check" size={11} /> In library
                              </span>
                            ) : null}
                            {dl ? (
                              <span className={`badge ${chart.needsConversion ? 'badge--convert' : 'badge--native'}`}>
                                {chartLabel(chart)}
                              </span>
                            ) : (
                              <button
                                className="plrow__na"
                                title={externalHint(chart)}
                                onClick={() => openChartExternal(chart)}
                              >
                                {unavailableTag(chart) ?? 'Manual'}
                                <Icon name="external" size={10} />
                              </button>
                            )}
                            {chart.charter ? <span className="plrow__charter">{chart.charter}</span> : null}
                            {chart.downloads != null && chart.downloads > 0 ? (
                              <span className="plrow__dls">
                                <Icon name="download" size={11} /> {formatDownloads(chart.downloads)}
                              </span>
                            ) : null}
                            {r.charts.length > 1 ? (
                              <button
                                className="plrow__versions"
                                onClick={() => setExpanded(expanded === i ? null : i)}
                              >
                                {r.charts.length} versions
                                <Icon name="caret" size={12} />
                              </button>
                            ) : null}
                          </>
                        ) : r.status === 'notfound' ? (
                          <span className="plrow__none">No chart found</span>
                        ) : r.status === 'searching' ? (
                          <span className="plrow__none">searching…</span>
                        ) : null}
                      </div>

                      {expanded === i && r.charts.length > 1 ? (
                        <div className="plrow__picker">
                          {r.charts.map((c, ci) => (
                            <button
                              key={c.key}
                              className={`plver ${ci === r.chosen ? 'plver--on' : ''}`}
                              title={isAutoDownloadable(c) ? undefined : externalHint(c)}
                              onClick={() => {
                                // Stažitelnou verzi vyber pro dávku; nestažitelnou
                                // (MEGA/Mediafire/DLC) rovnou otevři v prohlížeči.
                                if (isAutoDownloadable(c)) {
                                  patchRow(i, { chosen: ci, selected: true })
                                  setExpanded(null)
                                } else {
                                  openChartExternal(c)
                                }
                              }}
                            >
                              <span className="plver__radio">{ci === r.chosen ? '●' : '○'}</span>
                              {isAutoDownloadable(c) ? (
                                <span className={`badge ${c.needsConversion ? 'badge--convert' : 'badge--native'}`}>
                                  {chartLabel(c)}
                                </span>
                              ) : (
                                <span className="plrow__na">
                                  {unavailableTag(c) ?? 'Manual'}
                                  <Icon name="external" size={10} />
                                </span>
                              )}
                              <span className="plver__charter">{c.charter || 'Unknown charter'}</span>
                              {c.downloads != null && c.downloads > 0 ? (
                                <span className="plrow__dls">
                                  <Icon name="download" size={11} /> {formatDownloads(c.downloads)}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {phase === 'matching' || phase === 'done' ? (
          <div className="modal__foot plimport__foot">
            <button className="btn-secondary" onClick={resetAll}>
              Import another
            </button>
            <div className="plimport__footright">
              <span className="plimport__selcount">
                {selectedCharts.length} selected
                {selectedCharts.length > downloadable.length ? (
                  <span className="batchbar__note">{downloadable.length} downloadable</span>
                ) : null}
              </span>
              <button
                className="btn-primary"
                onClick={doDownload}
                disabled={downloadable.length === 0}
              >
                <Icon name="download" size={14} /> Download {downloadable.length}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
