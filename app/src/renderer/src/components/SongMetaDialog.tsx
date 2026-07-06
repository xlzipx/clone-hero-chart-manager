import { useEffect, useState } from 'react'
import type { SongMeta } from '../../../shared/types'

const FIELDS: { key: keyof SongMeta; label: string }[] = [
  { key: 'name', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'genre', label: 'Genre' },
  { key: 'year', label: 'Year' },
  { key: 'charter', label: 'Charter' }
]

/** Editace metadat (song.ini) jedné písně. `rel` = cesta ke složce v knihovně. */
export function SongMetaDialog({
  rel,
  title,
  onClose,
  onSaved
}: {
  rel: string
  title: string
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [fields, setFields] = useState<SongMeta | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api
      .libReadMeta(rel)
      .then((m) => !cancelled && setFields(m))
      .catch(() => !cancelled && setFields({}))
    return () => {
      cancelled = true
    }
  }, [rel])

  const save = async (): Promise<void> => {
    if (!fields) return
    setSaving(true)
    setError(null)
    try {
      await window.api.libWriteMeta(rel, fields)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="lib__dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lib__dialog lib__dialog--meta">
        <p className="metadlg__head">
          Edit metadata <span className="metadlg__sub">{title}</span>
        </p>
        {fields === null ? (
          <p className="wn__muted">Loading…</p>
        ) : (
          <div className="metadlg__grid">
            {FIELDS.map(({ key, label }) => (
              <label key={key} className="metadlg__field">
                <span>{label}</span>
                <input
                  value={fields[key] ?? ''}
                  onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void save()
                    if (e.key === 'Escape') onClose()
                  }}
                />
              </label>
            ))}
          </div>
        )}
        {error ? <p className="lib__error">⚠ {error}</p> : null}
        <p className="field__hint">
          Writes to the chart&apos;s song.ini. Clone Hero picks it up on its next library scan.
        </p>
        <div className="lib__dialog-foot">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!fields || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
