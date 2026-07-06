import { useEffect, useRef, useState } from 'react'
import type { PlaylistInfo, PlaylistSong } from '../../../shared/types'
import { Icon } from './Icon'
import { RichText } from './RichText'

/** Správce Clone Hero setlistů: přejmenování, mazání, zobrazení a odebírání písní. */
export function PlaylistManagerModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [lists, setLists] = useState<PlaylistInfo[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [songs, setSongs] = useState<PlaylistSong[] | null>(null)
  const [songsLoading, setSongsLoading] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Token proti závodu: rychlé klikání mezi playlisty nesmí nechat pomalejší
  // (starší) odpověď zobrazit písně pod hlavičkou jiného playlistu.
  const openSeq = useRef(0)

  const loadLists = async (keepSel?: string): Promise<void> => {
    setError(null)
    try {
      const l = await window.api.libListPlaylists()
      setLists(l)
      if (keepSel && l.some((p) => p.name === keepSel)) void openSetlist(keepSel)
      else {
        setSel(null)
        setSongs(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLists([])
      setSel(null)
      setSongs(null)
    }
  }
  useEffect(() => {
    void loadLists()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openSetlist = async (name: string): Promise<void> => {
    const my = ++openSeq.current
    setSel(name)
    setChecked(new Set())
    setSongs(null)
    setSongsLoading(true)
    try {
      const s = await window.api.libPlaylistSongs(name)
      if (my !== openSeq.current) return // mezitím kliknul na jiný playlist
      setSongs(s)
    } catch (e) {
      if (my !== openSeq.current) return
      setError(e instanceof Error ? e.message : String(e))
      setSongs([])
    } finally {
      if (my === openSeq.current) setSongsLoading(false)
    }
  }

  const run = async (fn: () => Promise<void>, keepSel?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await loadLists(keepSel)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Ref guard: Enter spustí rename a následný blur (input se odmountuje) by ho
  // spustil PODRUHÉ se starým názvem → chybová hláška. State `busy` nestačí
  // (update je async), ref je okamžitý.
  const renameBusyRef = useRef(false)
  const doRename = (name: string): void => {
    if (renameBusyRef.current) return
    const v = renameVal.trim()
    if (!v || v === name) {
      setRenaming(null)
      return
    }
    renameBusyRef.current = true
    setRenaming(null)
    void run(async () => {
      await window.api.libRenamePlaylist(name, v)
    }, v).finally(() => {
      renameBusyRef.current = false
    })
  }

  const removeChecked = (): void => {
    if (!sel || checked.size === 0) return
    void run(async () => {
      await window.api.libRemoveFromPlaylist(sel, [...checked])
    }, sel)
  }

  const toggle = (hash: string): void => {
    const next = new Set(checked)
    next.has(hash) ? next.delete(hash) : next.add(hash)
    setChecked(next)
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--plm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Playlists</h2>
          <button className="modal__close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="plm__body">
          {/* Seznam setlistů */}
          <div className="plm__lists">
            {lists === null ? (
              <p className="wn__muted plm__pad">Loading…</p>
            ) : lists.length === 0 ? (
              <p className="wn__muted plm__pad">
                No playlists yet. Select songs in the library and use Add to playlist.
              </p>
            ) : (
              lists.map((p) => (
                <div
                  key={p.name}
                  className={`plm__list ${sel === p.name ? 'plm__list--sel' : ''}`}
                  onClick={() => void openSetlist(p.name)}
                >
                  {renaming === p.name ? (
                    <input
                      className="plm__renameinput"
                      autoFocus
                      value={renameVal}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation()
                          doRename(p.name)
                        }
                        if (e.key === 'Escape') {
                          e.stopPropagation() // jinak window handler zavře celý Library manager
                          setRenaming(null)
                        }
                      }}
                      onBlur={() => doRename(p.name)}
                    />
                  ) : (
                    <span className="plm__listname">{p.name}</span>
                  )}
                  <span className="plm__listcount">{p.count}</span>
                  <button
                    className="plm__iconbtn"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenaming(p.name)
                      setRenameVal(p.name)
                    }}
                  >
                    <Icon name="charter" size={13} />
                  </button>
                  <button
                    className="plm__iconbtn plm__iconbtn--danger"
                    title="Delete playlist"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDel(p.name)
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Obsah vybraného setlistu */}
          <div className="plm__songs">
            {!sel ? (
              <p className="wn__muted plm__pad">Select a playlist to see its songs.</p>
            ) : songsLoading ? (
              <p className="wn__muted plm__pad">Resolving songs…</p>
            ) : songs && songs.length > 0 ? (
              <>
                <div className="plm__songlist">
                  {songs.map((s) => (
                    <label
                      key={s.hash}
                      className={`plm__song ${s.found ? '' : 'plm__song--missing'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(s.hash)}
                        onChange={() => toggle(s.hash)}
                      />
                      {s.found ? (
                        <span className="plm__songtext">
                          <span className="plm__songtitle">
                            <RichText text={s.title} />
                          </span>
                          {s.artist ? (
                            <span className="plm__songartist">
                              <RichText text={s.artist} />
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="plm__songtext">
                          <span className="plm__songtitle plm__songtitle--missing">
                            Not in your library
                          </span>
                          <span className="plm__songartist">{s.hash.slice(0, 12)}…</span>
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <div className="plm__songfoot">
                  <span className="dup__selinfo">{checked.size} selected</span>
                  <button
                    className="btn-secondary"
                    disabled={checked.size === 0 || busy}
                    onClick={removeChecked}
                  >
                    Remove from playlist
                  </button>
                </div>
              </>
            ) : (
              <p className="wn__muted plm__pad">This playlist is empty.</p>
            )}
          </div>
        </div>

        {error ? <div className="lib__error">⚠ {error}</div> : null}

        {confirmDel ? (
          <div
            className="lib__dialog-overlay"
            onMouseDown={(e) => e.target === e.currentTarget && setConfirmDel(null)}
          >
            <div className="lib__dialog">
              <p>
                Delete playlist <strong>{confirmDel}</strong>? The songs stay in your library, only
                the setlist is removed.
              </p>
              <div className="lib__dialog-foot">
                <button className="btn-secondary" onClick={() => setConfirmDel(null)}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    const n = confirmDel
                    setConfirmDel(null)
                    void run(() => window.api.libDeletePlaylist(n))
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
