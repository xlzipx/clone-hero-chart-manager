import { useEffect, useState } from 'react'
import type { DupExtras, DupGroup, SongDetail } from '../../../shared/types'
import { useStore } from '../store'
import { formatLength, stripTags } from '../utils'
import { Icon } from './Icon'
import { InstrumentDifficulty } from './InstrumentDifficulty'
import { RichText } from './RichText'

// Odznaky „co má složka navíc" — pomáhá rozhodnout, kterou kopii si nechat.
// Zobrazí se jen to, co je reálně přítomné.
const EXTRA_META: { key: keyof DupExtras; label: string; title: string }[] = [
  { key: 'stems', label: 'Stems', title: 'Separate instrument audio tracks (you can mute your own part)' },
  { key: 'video', label: 'Video', title: 'Background video' },
  { key: 'background', label: 'BG', title: 'Custom background image' },
  { key: 'highway', label: 'Highway', title: 'Custom highway texture' },
  { key: 'albumArt', label: 'Art', title: 'Album artwork' }
]

function Extras({ extras }: { extras: DupExtras }): JSX.Element | null {
  const present = EXTRA_META.filter((m) => extras[m.key])
  if (present.length === 0) return null
  return (
    <span className="dup__extras">
      {present.map((m) => (
        <span key={m.key} className={`dup__extra dup__extra--${m.key}`} title={m.title}>
          {m.label}
        </span>
      ))}
    </span>
  )
}

/** Rozbalovací detail jedné kopie PŘÍMO v okně duplicit (bez odchodu do
 *  manageru) — album, obtížnosti nástrojů, délka, „Show in Explorer". Slouží
 *  k rozhodnutí, kterou verzi si nechat. */
function CopyDetail({ rel }: { rel: string }): JSX.Element {
  const [detail, setDetail] = useState<SongDetail | null>(null)
  useEffect(() => {
    let cancelled = false
    setDetail(null)
    void window.api
      .libSongDetail(rel)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        /* nevadí — panel zůstane prázdný */
      })
    return () => {
      cancelled = true
    }
  }, [rel])

  if (!detail) return <div className="dup__detail dup__detail--loading">Loading details…</div>
  const info = detail.info
  const line1 = [info && stripTags(info.album), info?.year || null, info && stripTags(info.genre)]
    .filter(Boolean)
    .join(' · ')
  const line2 = [
    info?.charter ? `by ${stripTags(info.charter)}` : null,
    info?.lengthSeconds ? formatLength(info.lengthSeconds) : null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="dup__detail">
      {detail.albumArt ? (
        <img className="dup__detailart" src={detail.albumArt} alt="" />
      ) : (
        <div className="dup__detailart dup__detailart--none">
          <Icon name="note" size={20} />
        </div>
      )}
      <div className="dup__detailmeta">
        {line1 ? <div className="dup__detailsub">{line1}</div> : null}
        {line2 ? <div className="dup__detailsub">{line2}</div> : null}
        {info ? <InstrumentDifficulty difficulties={info.difficulties} /> : null}
        <button className="linkbtn dup__reveal" onClick={() => window.api.libReveal(rel)}>
          <Icon name="external" size={12} /> Show in Explorer
        </button>
      </div>
    </div>
  )
}

/** Najde a nabídne smazání/přesun duplicit v knihovně. `onChanged` = po akci obnovit. */
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
  // Rel kopie, jejíž detail je právě rozbalený (jen jeden naráz).
  const [detailFor, setDetailFor] = useState<string | null>(null)
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
          {g.songs[0].artist ? (
            <>
              <RichText text={g.songs[0].artist} /> —{' '}
            </>
          ) : null}
          <RichText text={g.songs[0].title} />
        </span>
        <span className="dup__count">{g.songs.length} copies</span>
      </div>
      {g.songs.map((s) => (
        <div key={s.rel} className="dup__copy">
          <label className="dup__row">
            <input type="checkbox" checked={checked.has(s.rel)} onChange={() => toggle(s.rel)} />
            <span className="dup__rowmain">
              {/* RichText i na názvu složky — na Linuxu smí složka obsahovat
                  <color=…> tagy v názvu (na Windows ne), jinak by se ukázaly syrově. */}
              <span className="dup__folder">
                <RichText text={s.name} />
              </span>
              <Extras extras={s.extras} />
            </span>
            {s.charter ? (
              <span className="dup__charter">
                <RichText text={s.charter} />
              </span>
            ) : null}
            <button
              type="button"
              className={`dup__openbtn ${detailFor === s.rel ? 'dup__openbtn--on' : ''}`}
              title="Show this copy's details to compare (album, difficulties, length)"
              onClick={(e) => {
                // Řádek je <label> — bez preventDefault by klik zaškrtl checkbox.
                e.preventDefault()
                e.stopPropagation()
                setDetailFor((cur) => (cur === s.rel ? null : s.rel))
              }}
            >
              <Icon name="info" size={15} />
            </button>
          </label>
          {detailFor === s.rel ? <CopyDetail rel={s.rel} /> : null}
        </div>
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
