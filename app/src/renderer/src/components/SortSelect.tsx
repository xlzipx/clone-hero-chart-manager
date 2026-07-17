import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { SortKey } from '../store'
import { Icon } from './Icon'

// `rvOnly`: RhythmVerse má počet stažení, Chorus Encore ne → v Encore režimu
// „Downloads" nezobrazujeme (nešlo by seřadit, jen by matlo).
// Popisky jsou BEZ směru (dřív „Title (A–Z)") — směr řídí zvlášť šipka vedle.
const OPTIONS: { id: SortKey; label: string; rvOnly?: boolean; hint: string }[] = [
  {
    id: 'relevance',
    label: 'Default',
    hint: 'The source order — best match when searching, or the catalogue’s own default when browsing'
  },
  { id: 'title', label: 'Title', hint: 'Alphabetical by song title' },
  { id: 'artist', label: 'Artist', hint: 'Alphabetical by artist' },
  {
    id: 'downloads',
    label: 'Downloads',
    rvOnly: true,
    hint: 'By RhythmVerse download count'
  },
  { id: 'newest', label: 'Added', hint: 'By date added / last updated' },
  { id: 'length', label: 'Length', hint: 'By song length' }
]

export function SortSelect(): JSX.Element {
  const sort = useStore((s) => s.sort)
  const sortDir = useStore((s) => s.sortDir)
  const sortTouched = useStore((s) => s.sortTouched)
  const setSort = useStore((s) => s.setSort)
  const setSortDir = useStore((s) => s.setSortDir)
  const database = useStore((s) => s.database)
  const options = OPTIONS.filter((o) => !o.rvOnly || database !== 'enchor')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = options.find((o) => o.id === sort) ?? options[0]
  // „Default" (relevance) nemá směr — server řadí podle relevance/vlastního pořadí.
  const dirEnabled = current.id !== 'relevance'

  return (
    <div className="sortctl" ref={ref}>
      <div className={`dd dd--sort ${open ? 'dd--open' : ''}`}>
        <button type="button" className="dd__btn" onClick={() => setOpen((o) => !o)} title={current.hint}>
          {/* Dokud uživatel sort AKTIVNĚ nezvolil, ukaž „Sort by" jako pozvánku. */}
          <span>{sortTouched ? current.label : 'Sort by'}</span>
          <Icon name="caret" size={11} className="dd__caret" />
        </button>
        {open ? (
          <ul className="dd__menu" role="listbox">
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  title={o.hint}
                  className={`dd__item ${o.id === sort ? 'dd__item--sel' : ''}`}
                  onClick={() => {
                    setSort(o.id)
                    setOpen(false)
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {/* Přepínač směru — zašedlý u „Default", kde řazení nemá směr. */}
      <button
        type="button"
        className="sortctl__dir"
        disabled={!dirEnabled}
        title={
          !dirEnabled
            ? 'Default order has no direction'
            : sortDir === 'asc'
              ? 'Ascending — click for descending'
              : 'Descending — click for ascending'
        }
        onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
      >
        <Icon name="caret" size={12} style={{ transform: sortDir === 'asc' ? 'rotate(180deg)' : 'none' }} />
      </button>
    </div>
  )
}
