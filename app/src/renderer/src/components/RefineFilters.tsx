import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

/**
 * Rozbalovací „Refine" panel v liště výsledků: filtruje NAČTENÉ výsledky podle
 * charteru, alba a roku (contains). Skryté defaultně, ať to nezaneřádí UI.
 */
export function RefineFilters(): JSX.Element {
  const charter = useStore((s) => s.charterFilter)
  const album = useStore((s) => s.albumFilter)
  const year = useStore((s) => s.yearFilter)
  const hideOwned = useStore((s) => s.hideOwned)
  const setCharter = useStore((s) => s.setCharterFilter)
  const setAlbum = useStore((s) => s.setAlbumFilter)
  const setYear = useStore((s) => s.setYearFilter)
  const setHideOwned = useStore((s) => s.setHideOwned)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = !!(charter || album || year || hideOwned)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const clear = (): void => {
    setCharter('')
    setAlbum('')
    setYear('')
    setHideOwned(false)
  }

  return (
    <div className={`refine ${open ? 'refine--open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`refine__toggle ${active ? 'refine__toggle--on' : ''}`}
        title="Refine loaded results by charter, album or year"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="filter" size={13} />
        <span>Refine</span>
        {active ? <span className="refine__dot" /> : null}
      </button>

      {open ? (
        <div className="refine__panel" role="dialog">
          <label className="refine__field">
            <span>Charter</span>
            <input
              value={charter}
              placeholder="e.g. Chezy"
              onChange={(e) => setCharter(e.target.value)}
              autoFocus
            />
          </label>
          <label className="refine__field">
            <span>Album</span>
            <input
              value={album}
              placeholder="e.g. Meteora"
              onChange={(e) => setAlbum(e.target.value)}
            />
          </label>
          <label className="refine__field">
            <span>Year</span>
            <input
              value={year}
              placeholder="e.g. 2003"
              inputMode="numeric"
              onChange={(e) => setYear(e.target.value)}
            />
          </label>
          <label className="chk refine__check">
            <input
              type="checkbox"
              checked={hideOwned}
              onChange={(e) => setHideOwned(e.target.checked)}
            />
            <span className="chk__box">
              <Icon name="check" size={12} />
            </span>
            <span>Hide songs I already have</span>
          </label>

          <div className="refine__foot">
            <span className="refine__hint">Filters the results already loaded on this page.</span>
            {active ? (
              <button type="button" className="refine__clear" onClick={clear}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
