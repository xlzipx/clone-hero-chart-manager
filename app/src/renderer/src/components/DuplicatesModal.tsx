import { useEffect, useState } from 'react'
import type { DupGroup } from '../../../shared/types'
import { Icon } from './Icon'

/** Najde a nabídne smazání duplicit v knihovně. `onChanged` = po smazání obnovit. */
export function DuplicatesModal({
  onClose,
  onChanged
}: {
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const [groups, setGroups] = useState<DupGroup[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = async (): Promise<void> => {
    setGroups(null)
    setChecked(new Set())
    setError(null)
    try {
      setGroups(await window.api.libFindDuplicates())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGroups([])
    }
  }
  useEffect(() => {
    void scan()
  }, [])

  const toggle = (rel: string): void => {
    const next = new Set(checked)
    next.has(rel) ? next.delete(rel) : next.add(rel)
    setChecked(next)
  }

  const identical = (groups ?? []).filter((g) => g.reason === 'identical')
  const variants = (groups ?? []).filter((g) => g.reason === 'same-song')

  const deleteChecked = async (): Promise<void> => {
    if (checked.size === 0 || busy) return
    setBusy(true)
    setError(null)
    // Jednotlivé selhání nezastaví zbytek a hlavně: i po chybě se MUSÍ rescan,
    // jinak seznam dál ukazuje už smazané položky a opakované Delete zase hází chybu.
    let failed: string | null = null
    for (const rel of checked) {
      try {
        await window.api.libTrash(rel)
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e)
      }
    }
    onChanged()
    await scan()
    if (failed) setError(failed)
    setBusy(false)
  }

  const renderGroup = (g: DupGroup, gi: number): JSX.Element => (
    <div className="dup__group" key={`${g.reason}-${gi}`}>
      <div className="dup__grouphead">
        <span className="dup__song">
          {g.songs[0].artist ? `${g.songs[0].artist} — ` : ''}
          {g.songs[0].title}
        </span>
        <span className="dup__count">{g.songs.length} copies</span>
      </div>
      {g.songs.map((s) => (
        <label key={s.rel} className="dup__row">
          <input type="checkbox" checked={checked.has(s.rel)} onChange={() => toggle(s.rel)} />
          <span className="dup__folder">{s.name}</span>
          {s.charter ? <span className="dup__charter">{s.charter}</span> : null}
        </label>
      ))}
    </div>
  )

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--dup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Find duplicates</h2>
          <button className="modal__close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="modal__body dup__body">
          {groups === null ? (
            <p className="wn__p wn__muted">Scanning your library…</p>
          ) : groups.length === 0 ? (
            <p className="wn__p wn__muted">No duplicates found. Your library is tidy.</p>
          ) : (
            <>
              {identical.length > 0 ? (
                <>
                  <h4 className="wn__h">Identical charts ({identical.length})</h4>
                  <p className="field__hint">
                    Byte-for-byte the same. Keep one, tick the rest to remove.
                  </p>
                  {identical.map(renderGroup)}
                </>
              ) : null}
              {variants.length > 0 ? (
                <>
                  <h4 className="wn__h">Same song, different versions ({variants.length})</h4>
                  <p className="field__hint">
                    Same title and artist but different charts (e.g. another charter). Your call.
                  </p>
                  {variants.map(renderGroup)}
                </>
              ) : null}
            </>
          )}
          {error ? <p className="lib__error">⚠ {error}</p> : null}
        </div>

        <div className="modal__foot dup__foot">
          <button className="btn-secondary" onClick={() => void scan()} disabled={busy || groups === null}>
            Rescan
          </button>
          <div className="lib__spacer" />
          <span className="dup__selinfo">{checked.size} selected</span>
          <button
            className="btn-primary"
            disabled={checked.size === 0 || busy}
            onClick={() => void deleteChecked()}
          >
            {busy ? 'Deleting…' : `Move ${checked.size || ''} to Recycle Bin`}
          </button>
        </div>
      </div>
    </div>
  )
}
