import { useEffect, useState } from 'react'
import type { DupGroup } from '../../../shared/types'
import { useStore } from '../store'
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
  // Potvrzení poslední akce („Moved N to …") — zobrazuje se NAD patičkou, mimo
  // scroll, stejně jako chyba. U 92 skupin by hláška na konci seznamu nebyla vidět.
  const [notice, setNotice] = useState<string | null>(null)

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
    const count = checked.size
    setBusy(true)
    setError(null)
    setNotice(null)
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
    else setNotice(`Moved ${count} ${count === 1 ? 'chart' : 'charts'} to the Recycle Bin.`)
    setBusy(false)
  }

  // Alternativa ke koši (návrh z Redditu): přesun duplicit do zvolené složky.
  // Koš jde přes Windows shell API, které nefunguje ve Wine/VM na Linuxu —
  // tohle je čistý fs přesun. Zároveň slouží jako bezpečnější „karanténa".
  const moveChecked = async (): Promise<void> => {
    if (checked.size === 0 || busy) return
    const count = checked.size
    const last = useStore.getState().config?.dupMoveDir
    const dir = await window.api.chooseDirectory(last || undefined)
    if (!dir) return
    setBusy(true)
    setError(null)
    setNotice(null)
    let failed: string | null = null
    try {
      await window.api.libMoveOut([...checked], dir)
      // Zapamatuj složku pro příště (i pro předvyplnění dialogu).
      void useStore.getState().saveConfig({ dupMoveDir: dir })
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e)
    }
    onChanged()
    await scan() // i po chybě — část položek už mohla být přesunuta
    if (failed) setError(failed)
    else setNotice(`Moved ${count} ${count === 1 ? 'chart' : 'charts'} to ${dir}.`)
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
        </div>

        {/* Chyba/potvrzení MIMO scrollovatelné tělo — u dlouhého seznamu by na
            jeho konci nebyly vidět (uživatel si myslel, že se „nic nestalo"). */}
        {error ? <div className="lib__error">⚠ {error}</div> : null}
        {!error && notice ? <div className="dup__notice">✓ {notice}</div> : null}

        <div className="modal__foot dup__foot">
          <button className="btn-secondary" onClick={() => void scan()} disabled={busy || groups === null}>
            Rescan
          </button>
          <div className="lib__spacer" />
          <span className="dup__selinfo">{checked.size} selected</span>
          <button
            className="btn-secondary"
            disabled={checked.size === 0 || busy}
            title="Move the ticked charts to a folder of your choice instead of deleting them. Handy as a quarantine, and works where the Recycle Bin does not (e.g. Wine on Linux)."
            onClick={() => void moveChecked()}
          >
            Move to folder…
          </button>
          <button
            className="btn-primary"
            disabled={checked.size === 0 || busy}
            onClick={() => void deleteChecked()}
          >
            {busy ? 'Working…' : `Move ${checked.size || ''} to Recycle Bin`}
          </button>
        </div>
      </div>
    </div>
  )
}
