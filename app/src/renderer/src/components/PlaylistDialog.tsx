import { useEffect, useState } from 'react'
import type { PlaylistAddResult, PlaylistInfo } from '../../../shared/types'

/** Přidá vybrané písně (rel cesty) do Clone Hero playlistu — nového nebo existujícího. */
export function PlaylistDialog({
  rels,
  onClose
}: {
  rels: string[]
  onClose: () => void
}): JSX.Element {
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PlaylistAddResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api
      .libListPlaylists()
      .then((p) => !cancelled && setPlaylists(p))
      .catch(() => !cancelled && setPlaylists([]))
    return () => {
      cancelled = true
    }
  }, [])

  const add = async (target: string): Promise<void> => {
    const t = target.trim()
    if (!t) return
    setBusy(true)
    setError(null)
    try {
      setResult(await window.api.libAddToPlaylist(t, rels))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lib__dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lib__dialog lib__dialog--playlist">
        <p className="metadlg__head">
          Add to playlist <span className="metadlg__sub">{rels.length} song{rels.length === 1 ? '' : 's'}</span>
        </p>

        {result ? (
          <>
            <p className="wn__p">
              Added <strong>{result.added}</strong>, skipped {result.skipped} already in it
              {result.missingHash ? `, ${result.missingHash} had no chart file` : ''}. Playlist now
              has <strong>{result.total}</strong> songs.
            </p>
            <p className="field__hint">Open the setlist in Clone Hero to play it.</p>
            <div className="lib__dialog-foot">
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="metadlg__field">
              <span>New playlist</span>
              <div className="field__row">
                <input
                  autoFocus
                  placeholder="e.g. Warm-up set"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      if (!busy) void add(name)
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation() // jinak window handler zavře celý Library manager
                      onClose()
                    }
                  }}
                />
                <button disabled={!name.trim() || busy} onClick={() => void add(name)}>
                  Create
                </button>
              </div>
            </label>

            {playlists === null ? (
              <p className="wn__muted">Loading playlists…</p>
            ) : playlists.length > 0 ? (
              <div className="pldlg__existing">
                <span className="metadlg__field-label">Or add to an existing one</span>
                <div className="pldlg__list">
                  {playlists.map((p) => (
                    <button
                      key={p.name}
                      className="pldlg__item"
                      disabled={busy}
                      onClick={() => void add(p.name)}
                    >
                      <span className="pldlg__name">{p.name}</span>
                      <span className="pldlg__count">{p.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="field__hint">No playlists yet. Create your first one above.</p>
            )}

            {error ? <p className="lib__error">⚠ {error}</p> : null}
            <div className="lib__dialog-foot">
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
