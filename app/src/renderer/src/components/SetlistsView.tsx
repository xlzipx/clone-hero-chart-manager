import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibSongInfo, PlaylistInfo, PlaylistSong } from '../../../shared/types'
import { errMsg } from '../../../shared/errors'
import { useStore } from '../store'
import { formatLength, stripTags } from '../utils'
import { Icon, type IconName } from './Icon'
import { LocalPreview } from './LocalPreview'
import { RichText } from './RichText'

/** Hlavička nástroje knihovny ve stylu Nastavení (barevná dlaždice + titulek). */
export function ToolHead({
  icon,
  color,
  title,
  sub,
  children
}: {
  icon: IconName
  color: string
  title: string
  sub: string
  children?: React.ReactNode
}): JSX.Element {
  return (
    <header className="stv__head ltool__head" style={{ '--sc': color } as React.CSSProperties}>
      <span className="stv__headicon">
        <Icon name={icon} size={22} />
      </span>
      <div className="stv__headtext">
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {children ? <div className="ltool__headactions">{children}</div> : null}
    </header>
  )
}

/** Obal + ukázka písně z knihovny (stejné chování jako karty v My Library). */
export function SongArt({
  rel,
  thumb,
  previewKey,
  size = 'sm'
}: {
  rel?: string
  thumb?: string | null
  previewKey: string
  size?: 'sm' | 'lg'
}): JSX.Element {
  return (
    <div className={`song__art ltool__art ltool__art--${size}`}>
      {thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name="note" size={size === 'lg' ? 30 : 18} />}
      {rel ? <LocalPreview previewKey={previewKey} rel={rel} size={size === 'lg' ? 20 : 14} /> : null}
    </div>
  )
}

/** Načte obaly a metadata pro seznam složek (po dávkách, s cache napříč obrazovkami). */
const thumbMemo = new Map<string, string | null>()
const infoMemo = new Map<string, LibSongInfo>()
export function useSongExtras(rels: string[]): {
  thumbs: Record<string, string | null>
  infos: Record<string, LibSongInfo>
} {
  const [, bump] = useState(0)
  const key = rels.join('\n')
  useEffect(() => {
    let alive = true
    const needInfo = rels.filter((r) => !infoMemo.has(r))
    const needThumb = rels.filter((r) => !thumbMemo.has(r))
    // Překreslovat nejvýš ~3× za vteřinu, ne po každé dávce (u stovek písní by
    // jinak každá dávka obalů překreslila celý seznam).
    let last = performance.now()
    const maybeBump = (force = false): void => {
      if (!force && performance.now() - last < 300) return
      last = performance.now()
      bump((n) => n + 1)
    }
    void (async () => {
      for (let i = 0; i < needInfo.length; i += 80) {
        try {
          const got = await window.api.libSongInfo(needInfo.slice(i, i + 80))
          for (const g of got) infoMemo.set(g.rel, g)
        } catch {
          /* bez metadat */
        }
        if (!alive) return
        maybeBump()
      }
      maybeBump(true)
      for (let i = 0; i < needThumb.length; i += 16) {
        const chunk = needThumb.slice(i, i + 16)
        try {
          const got = await window.api.libAlbumThumbs(chunk)
          for (const r of chunk) thumbMemo.set(r, got[r] ?? null)
        } catch {
          for (const r of chunk) thumbMemo.set(r, null)
        }
        if (!alive) return
        maybeBump()
      }
      maybeBump(true)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const thumbs: Record<string, string | null> = {}
  const infos: Record<string, LibSongInfo> = {}
  for (const r of rels) {
    if (thumbMemo.has(r)) thumbs[r] = thumbMemo.get(r) ?? null
    const inf = infoMemo.get(r)
    if (inf) infos[r] = inf
  }
  return { thumbs, infos }
}
/** Po smazání / přesunu složek jejich data z cache zahodit. */
export function forgetSongExtras(rels: string[]): void {
  for (const r of rels) {
    thumbMemo.delete(r)
    infoMemo.delete(r)
  }
}

let lastSetlist: string | null = null

/** Celková délka setlistu: „1 h 12 min" / „48 min". */
function totalDuration(sec: number): string {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

/** Setlisty jako plnohodnotná obrazovka knihovny (dřív modální okno). */
export function SetlistsView({ onReveal }: { onReveal: (rel: string) => void }): JSX.Element {
  const playPlaylist = useStore((s) => s.playPlaylist)
  const compact = useStore((s) => s.config?.setlistCompact ?? false)
  const setCompact = (v: boolean): void => void useStore.getState().saveConfig({ setlistCompact: v })
  const [lists, setLists] = useState<PlaylistInfo[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [songs, setSongs] = useState<PlaylistSong[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const openSeq = useRef(0)

  const openSetlist = async (name: string): Promise<void> => {
    const my = ++openSeq.current
    lastSetlist = name
    setSel(name)
    setChecked(new Set())
    setRenaming(false)
    setConfirmDel(false)
    setSongs(null)
    try {
      const s = await window.api.libPlaylistSongs(name)
      if (my === openSeq.current) setSongs(s)
    } catch (e) {
      if (my !== openSeq.current) return
      setError(errMsg(e))
      setSongs([])
    }
  }

  const loadLists = async (keep?: string | null): Promise<void> => {
    try {
      const l = await window.api.libListPlaylists()
      setLists(l)
      const want = keep && l.some((p) => p.name === keep) ? keep : l[0]?.name ?? null
      if (want) void openSetlist(want)
      else {
        setSel(null)
        setSongs(null)
      }
    } catch (e) {
      setError(errMsg(e))
      setLists([])
    }
  }
  useEffect(() => {
    void loadLists(lastSetlist)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(t)
  }, [notice])

  const run = async (fn: () => Promise<void>, keep: string | null, msg?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await loadLists(keep)
      if (msg) setNotice(msg)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const renameBusy = useRef(false)
  const doRename = (): void => {
    if (!sel || renameBusy.current) return
    const v = renameVal.trim()
    setRenaming(false)
    if (!v || v === sel) return
    renameBusy.current = true
    void run(() => window.api.libRenamePlaylist(sel, v), v, `Renamed to “${v}”`).finally(() => {
      renameBusy.current = false
    })
  }

  const rels = useMemo(() => (songs ?? []).filter((s) => s.rel).map((s) => s.rel as string), [songs])
  const { thumbs, infos } = useSongExtras(rels)
  const needle = q.trim().toLowerCase()
  const shown = (songs ?? []).filter(
    (s) => !needle || `${stripTags(s.title)} ${stripTags(s.artist)}`.toLowerCase().includes(needle)
  )
  const found = (songs ?? []).filter((s) => s.found).length
  const missing = (songs ?? []).length - found
  const totalLen = (songs ?? []).reduce((a, s) => a + ((s.rel && infos[s.rel]?.lengthSeconds) || 0), 0)
  const allChecked = shown.length > 0 && shown.every((s) => checked.has(s.hash))

  const toggle = (h: string): void =>
    setChecked((c) => {
      const n = new Set(c)
      n.has(h) ? n.delete(h) : n.add(h)
      return n
    })

  return (
    <div className="ltool" style={{ '--sc': '#d23bd2' } as React.CSSProperties}>
      <ToolHead icon="note" color="#d23bd2" title="Setlists" sub="Clone Hero setlists from your Songs folder. Play them, rename them or tidy what's inside.">
        {notice ? (
          <span className="stv__notice">
            <Icon name="check" size={12} /> {notice}
          </span>
        ) : null}
      </ToolHead>

      <div className="ltool__split">
        {/* Seznam setlistů */}
        <nav className="slv__lists" aria-label="Setlists">
          <div className="ltool__label">
            Your setlists {lists ? <span className="ltool__labelcount">{lists.length}</span> : null}
          </div>
          {lists === null ? (
            <p className="ltool__muted">Loading…</p>
          ) : lists.length === 0 ? (
            <div className="ltool__empty ltool__empty--small">
              <Icon name="note" size={22} />
              <p>No setlists yet. In Songs, select some songs and choose Add to setlist.</p>
            </div>
          ) : (
            lists.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`slv__list ${sel === p.name ? 'slv__list--on' : ''}`}
                onClick={() => void openSetlist(p.name)}
              >
                <span className="slv__listicon">
                  <Icon name="playlist" size={15} />
                </span>
                <span className="slv__listtext">
                  <span className="slv__listname">{p.name}</span>
                  <span className="slv__listsub">
                    {p.count} {p.count === 1 ? 'song' : 'songs'}
                  </span>
                </span>
              </button>
            ))
          )}
        </nav>

        {/* Obsah vybraného setlistu */}
        <section className="slv__main">
          {!sel ? (
            <div className="ltool__empty">
              <Icon name="playlist" size={34} />
              <p>{lists && lists.length === 0 ? 'Setlists you create show up here.' : 'Pick a setlist on the left.'}</p>
            </div>
          ) : (
            <>
              <div className="slv__top">
                <div className="slv__cover" aria-hidden="true">
                  {rels
                    .slice(0, 4)
                    .map((r) => thumbs[r])
                    .filter(Boolean)
                    .slice(0, 4)
                    .map((t, i) => (
                      <img key={i} src={t as string} alt="" />
                    ))}
                  {rels.every((r) => !thumbs[r]) ? <Icon name="playlist" size={34} /> : null}
                </div>
                <div className="slv__topmain">
                  <div className="ltool__label">Setlist</div>
                  {renaming ? (
                    <input
                      className="slv__renameinput"
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') doRename()
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setRenaming(false)
                        }
                      }}
                      onBlur={doRename}
                    />
                  ) : (
                    <h3 className="slv__title">{sel}</h3>
                  )}
                  <div className="slv__meta">
                    {songs === null
                      ? 'Loading songs…'
                      : `${songs.length} ${songs.length === 1 ? 'song' : 'songs'}${totalLen ? ` · ${totalDuration(totalLen)}` : ''}${missing ? ` · ${missing} not in your library` : ''}`}
                  </div>
                  <div className="slv__actions">
                    <button
                      className="btn-primary"
                      disabled={!found || busy}
                      onClick={() => void playPlaylist(sel, sel)}
                      title="Play this setlist in the built-in music player"
                    >
                      <Icon name="play" size={13} /> Play
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        setRenameVal(sel)
                        setRenaming(true)
                      }}
                    >
                      <Icon name="charter" size={13} /> Rename
                    </button>
                    {missing > 0 ? (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        title="Remove every song that isn't in your library from this setlist"
                        onClick={() => {
                          const miss = (songs ?? []).filter((x) => !x.found).map((x) => x.hash)
                          void run(
                            () => window.api.libRemoveFromPlaylist(sel, miss),
                            sel,
                            `Removed ${miss.length} missing ${miss.length === 1 ? 'song' : 'songs'}`
                          )
                        }}
                      >
                        <Icon name="close" size={13} /> Remove {missing} missing
                      </button>
                    ) : null}
                    <button className="btn-secondary ltool__danger" disabled={busy} onClick={() => setConfirmDel(true)}>
                      <Icon name="trash" size={13} /> Delete
                    </button>
                  </div>
                </div>
              </div>

              {confirmDel ? (
                <div className="ltool__confirm" role="alertdialog">
                  <Icon name="alert" size={15} />
                  <span>
                    Delete setlist <strong>{sel}</strong>? The songs stay in your library.
                  </span>
                  <button className="btn-secondary" onClick={() => setConfirmDel(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary ltool__dangerbtn"
                    onClick={() => {
                      const n = sel
                      setConfirmDel(false)
                      void run(() => window.api.libDeletePlaylist(n), null, `Deleted “${n}”`)
                    }}
                  >
                    Delete setlist
                  </button>
                </div>
              ) : null}

              <div className="slv__tools">
                <label className="chk" title={allChecked ? 'Deselect all' : 'Select all'}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => setChecked(allChecked ? new Set() : new Set(shown.map((s) => s.hash)))}
                  />
                  <span className="chk__box">
                    <Icon name="check" size={12} />
                  </span>
                </label>
                <div className="ltool__search">
                  <Icon name="search" size={14} />
                  <input placeholder="Filter songs…" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="lv__seg" role="group" aria-label="View">
                  <button type="button" className={!compact ? 'on' : ''} onClick={() => setCompact(false)} title="With album art and previews">
                    <Icon name="cards" size={15} />
                  </button>
                  <button type="button" className={compact ? 'on' : ''} onClick={() => setCompact(true)} title="List: compact, without album art">
                    <Icon name="list" size={15} />
                  </button>
                </div>
              </div>

              <div className={`slv__songs ${compact ? 'slv__songs--compact' : ''}`}>
                {songs === null ? (
                  <p className="ltool__muted">Resolving songs…</p>
                ) : songs.length === 0 ? (
                  <div className="ltool__empty ltool__empty--small">
                    <p>This setlist is empty.</p>
                  </div>
                ) : (
                  shown.map((s, i) => {
                    const inf = s.rel ? infos[s.rel] : undefined
                    return (
                      <div
                        key={s.hash}
                        className={`slv__song ${checked.has(s.hash) ? 'slv__song--on' : ''} ${s.found ? '' : 'slv__song--missing'}`}
                        onClick={() => toggle(s.hash)}
                      >
                        <label className="chk" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={checked.has(s.hash)} onChange={() => toggle(s.hash)} />
                          <span className="chk__box">
                            <Icon name="check" size={12} />
                          </span>
                        </label>
                        <span className="slv__num">{(songs.indexOf(s) + 1).toString().padStart(2, '0')}</span>
                        {compact ? null : (
                          <span onClick={(e) => e.stopPropagation()}>
                            <SongArt rel={s.rel} thumb={s.rel ? thumbs[s.rel] : null} previewKey={`slv:${s.hash}:${i}`} />
                          </span>
                        )}
                        <span className="slv__songtext">
                          {s.found ? (
                            <>
                              <span className="slv__songtitle">
                                <RichText text={s.title} />
                              </span>
                              <span className="slv__songsub">
                                <RichText text={s.artist} />
                                {inf?.album ? <span className="ltool__dim"> · {stripTags(inf.album)}</span> : null}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="slv__songtitle">
                                {s.title ? <span className="ltool__dim"><RichText text={s.title} /></span> : null}
                                <span className="slv__missingtag" title="No chart in your Songs folder matches this setlist entry (deleted, moved, or replaced by another version)">
                                  Not in your library
                                </span>
                              </span>
                              <span className="slv__songsub ltool__dim">
                                {s.artist ? <RichText text={s.artist} /> : `Chart hash ${s.hash.slice(0, 12)}…`}
                              </span>
                            </>
                          )}
                        </span>
                        <span className="slv__len">{inf?.lengthSeconds ? formatLength(inf.lengthSeconds) : ''}</span>
                        {s.rel ? (
                          <button
                            type="button"
                            className="ltool__iconbtn"
                            title="Show in Songs"
                            onClick={(e) => {
                              e.stopPropagation()
                              onReveal(s.rel as string)
                            }}
                          >
                            <Icon name="folder" size={14} />
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              {checked.size > 0 ? (
                <div className="ltool__bar">
                  <span>
                    <strong>{checked.size}</strong> selected
                  </span>
                  <div className="lib__spacer" />
                  <button className="btn-secondary" onClick={() => setChecked(new Set())}>
                    Clear
                  </button>
                  <button
                    className="btn-primary ltool__dangerbtn"
                    disabled={busy}
                    onClick={() => {
                      const n = checked.size
                      void run(
                        () => window.api.libRemoveFromPlaylist(sel, [...checked]),
                        sel,
                        `Removed ${n} ${n === 1 ? 'song' : 'songs'} from the setlist`
                      )
                    }}
                  >
                    Remove from setlist
                  </button>
                </div>
              ) : null}
            </>
          )}
          {error ? <div className="lib__error">⚠ {error}</div> : null}
        </section>
      </div>
    </div>
  )
}
