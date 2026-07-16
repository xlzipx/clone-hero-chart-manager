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

/** Odznaky řádku: nejdřív KDE kopie leží, pak co má navíc (stems/art/…). */
function Extras({ extras, rel }: { extras: DupExtras; rel: string }): JSX.Element {
  const present = EXTRA_META.filter((m) => extras[m.key])
  return (
    <span className="dup__extras">
      <FolderTag rel={rel} />
      {present.map((m) => (
        <span key={m.key} className={`dup__extra dup__extra--${m.key}`} title={m.title}>
          {m.label}
        </span>
      ))}
    </span>
  )
}

/**
 * Složka, ve které kopie leží (bez názvu složky písně) — „1 Downloads", nebo
 * „Rock/Metallica" u vnořených. Prázdné = píseň sedí přímo v Songs.
 *
 * Bere se z `rel`, který cestu už nese, takže backend kvůli tomu neměníme.
 */
function parentFolder(rel: string): string {
  return rel.split('/').slice(0, -1).join('/')
}

/**
 * Kde kopie leží. Bez tohohle nejdou od sebe rozeznat dvě kopie se STEJNÝM
 * názvem složky (typicky po stažení téhož chartu dvakrát jinam) — jediná
 * cesta k tomu byla rozklikat detail. Nahlásil XbalakayX.
 */
function FolderTag({ rel }: { rel: string }): JSX.Element {
  const parent = parentFolder(rel)
  return (
    <span
      className={`dup__where ${parent ? '' : 'dup__where--root'}`}
      title={parent ? `Located in Songs/${parent}` : 'Located directly in the Songs folder'}
    >
      <Icon name="folder" size={10} />
      {parent || 'Songs'}
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
  // Rely kopií s rozbaleným detailem — víc naráz (kvůli porovnání kopií vedle sebe).
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set())
  // Potvrzení poslední akce („Moved N to …") — zobrazuje se NAD patičkou, mimo
  // scroll, stejně jako chyba. U 92 skupin by hláška na konci seznamu nebyla vidět.
  const [notice, setNotice] = useState<string | null>(null)
  // Rozsah hledání: prázdné = celá knihovna (výchozí, jako dřív). Nabízíme jen
  // složky 1. úrovně — vnořený výběr by mohl vyrobit překrývající se rozsahy.
  const [folders, setFolders] = useState<string[]>([])
  const [scope, setScope] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  // Rozlišuje „uživatel si ještě nevybral rozsah" (úvodní obrazovka) od
  // „skenuje se" — obojí má jinak `groups === null`.
  const [started, setStarted] = useState(false)

  useEffect(() => {
    void window.api
      .listSongFolders()
      .then(setFolders)
      .catch(() => setFolders([]))
  }, [])

  // Scan bere rozsah parametrem, ne ze stavu — `setScope` je async, takže
  // volající, který rozsah právě mění, by jinak skenoval tu STAROU hodnotu.
  const scan = async (withScope?: Set<string>): Promise<void> => {
    const sc = withScope ?? scope
    setStarted(true)
    setGroups(null)
    setChecked(new Set())
    setDetailOpen(new Set())
    setError(null)
    setNotice(null)
    try {
      setGroups(await window.api.libFindDuplicates(sc.size ? [...sc] : undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGroups([])
    }
  }
  // Záměrně se NESKENUJE hned po otevření: nejdřív si uživatel zvolí rozsah
  // (celá knihovna / vybrané složky). Automatický scan by volbu předběhl a
  // u velkých knihoven zbytečně projel to, o co uživatel nestál.

  const toggle = (rel: string): void => {
    const next = new Set(checked)
    next.has(rel) ? next.delete(rel) : next.add(rel)
    setChecked(next)
  }

  // Rozbalení detailu kopie — každá kopie nezávisle (víc otevřených naráz).
  const toggleDetail = (rel: string): void => {
    setDetailOpen((cur) => {
      const next = new Set(cur)
      next.has(rel) ? next.delete(rel) : next.add(rel)
      return next
    })
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
            <span className="chk">
              <input type="checkbox" checked={checked.has(s.rel)} onChange={() => toggle(s.rel)} />
              <span className="chk__box">
                <Icon name="check" size={12} />
              </span>
            </span>
            <span className="dup__rowmain">
              {/* RichText i na názvu složky — na Linuxu smí složka obsahovat
                  <color=…> tagy v názvu (na Windows ne), jinak by se ukázaly syrově. */}
              <span className="dup__folder">
                <RichText text={s.name} />
              </span>
              <Extras extras={s.extras} rel={s.rel} />
            </span>
            {s.charter ? (
              <span className="dup__charter">
                <RichText text={s.charter} />
              </span>
            ) : null}
            <button
              type="button"
              className={`dup__openbtn ${detailOpen.has(s.rel) ? 'dup__openbtn--on' : ''}`}
              title="Show this copy's details to compare (album, difficulties, length)"
              onClick={(e) => {
                // Řádek je <label> — bez preventDefault by klik zaškrtl checkbox.
                e.preventDefault()
                e.stopPropagation()
                toggleDetail(s.rel)
              }}
            >
              <Icon name="info" size={15} />
            </button>
          </label>
          {detailOpen.has(s.rel) ? <CopyDetail rel={s.rel} /> : null}
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

        {/* Pruh s rozsahem = jen PO spuštění; předtím volbu řeší úvodní obrazovka
            v těle, ať se nenabízí dvakrát. */}
        {started && folders.length > 0 ? (
          <div className="dup__scope">
            <button
              type="button"
              className={`dup__scopebtn ${scope.size ? 'dup__scopebtn--on' : ''}`}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((o) => !o)}
              disabled={busy}
            >
              <Icon name="folder" size={13} />
              {scope.size === 0
                ? 'Searching your whole library'
                : `Searching ${scope.size} of ${folders.length} folders`}
              <Icon name="caret" size={11} className="dup__scopecaret" />
            </button>
            {scope.size > 0 ? (
              <button
                type="button"
                className="dup__scopeclear"
                disabled={busy}
                onClick={() => {
                  setScope(new Set())
                  void scan(new Set())
                }}
              >
                Search everything
              </button>
            ) : null}
          </div>
        ) : null}

        {pickerOpen && started && folders.length > 0 ? (
          <div className="dup__picker">
            <p className="field__hint dup__pickerhint">
              Pick the folders to search. With none picked, the whole library is searched.
            </p>
            <div className="dup__pickerlist">
              {folders.map((f) => (
                <label key={f} className="dup__pickitem">
                  <span className="chk">
                    <input
                      type="checkbox"
                      checked={scope.has(f)}
                      onChange={() => {
                        const next = new Set(scope)
                        next.has(f) ? next.delete(f) : next.add(f)
                        setScope(next)
                      }}
                    />
                    <span className="chk__box">
                      <Icon name="check" size={12} />
                    </span>
                  </span>
                  <Icon name="folder" size={13} />
                  <span className="dup__pickname">{f}</span>
                </label>
              ))}
            </div>
            <div className="dup__pickerfoot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setScope(new Set())
                  setPickerOpen(false)
                  void scan(new Set())
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => {
                  setPickerOpen(false)
                  void scan()
                }}
              >
                <Icon name="search" size={13} /> Search
              </button>
            </div>
          </div>
        ) : null}

        <div className="modal__body dup__body">
          {!started ? (
            /* Úvodní volba: scan začne AŽ po ní. Na velké knihovně trvá, tak ať
               si uživatel nejdřív řekne, co vlastně chce projet. */
            <div className="dup__start">
              <p className="dup__starthint">
                Look for charts you have more than once. What should be searched?
              </p>
              <div className="dup__startopts">
                <button
                  className="dup__startopt"
                  onClick={() => {
                    // Rozsah MUSÍ pryč i s pickerem: kdo si předtím naklikal
                    // složky a pak dá „všechno", jinak by mu zůstal otevřený
                    // picker a horní lišta by lhala („Searching 3 of 12"),
                    // přestože se projelo všechno.
                    setScope(new Set())
                    setPickerOpen(false)
                    void scan(new Set())
                  }}
                >
                  <Icon name="folder" size={20} />
                  <span className="dup__startopttext">
                    <span className="dup__startopttitle">Search everything</span>
                    <span className="dup__startoptsub">Every folder in your Songs library.</span>
                  </span>
                </button>
                <button
                  className="dup__startopt"
                  disabled={folders.length === 0}
                  onClick={() => setPickerOpen(true)}
                >
                  <Icon name="filter" size={20} />
                  <span className="dup__startopttext">
                    <span className="dup__startopttitle">Pick folders</span>
                    <span className="dup__startoptsub">
                      {folders.length === 0
                        ? 'Your library has no subfolders.'
                        : `Choose from ${folders.length} folders. Faster on a big library.`}
                    </span>
                  </span>
                </button>
              </div>

              {pickerOpen && folders.length > 0 ? (
                <div className="dup__picker dup__picker--start">
                  <div className="dup__pickerlist">
                    {folders.map((f) => (
                      <label key={f} className="dup__pickitem">
                        <span className="chk">
                          <input
                            type="checkbox"
                            checked={scope.has(f)}
                            onChange={() => {
                              const next = new Set(scope)
                              next.has(f) ? next.delete(f) : next.add(f)
                              setScope(next)
                            }}
                          />
                          <span className="chk__box">
                            <Icon name="check" size={12} />
                          </span>
                        </span>
                        <Icon name="folder" size={13} />
                        <span className="dup__pickname">{f}</span>
                      </label>
                    ))}
                  </div>
                  <div className="dup__pickerfoot">
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setPickerOpen(false)
                        setScope(new Set())
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      disabled={scope.size === 0}
                      onClick={() => {
                        setPickerOpen(false)
                        void scan()
                      }}
                    >
                      <Icon name="search" size={13} />
                      {scope.size ? ` Search ${scope.size}` : ' Search'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : groups === null ? (
            <p className="wn__p wn__muted">
              {scope.size ? 'Scanning the selected folders…' : 'Scanning your library…'}
            </p>
          ) : groups.length === 0 ? (
            // Se zvoleným rozsahem NEtvrdíme „your library is tidy" — víme jen
            // to, co jsme prošli.
            <p className="wn__p wn__muted">
              {scope.size
                ? 'No duplicates found in the folders you picked.'
                : 'No duplicates found. Your library is tidy.'}
            </p>
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

        {/* Patička až po spuštění — Rescan ani mazání nedávají smysl, dokud se
            nic neprohledalo (na úvodní obrazovce by jen mátly). */}
        {started ? (
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
        ) : null}
      </div>
    </div>
  )
}
