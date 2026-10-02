import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

/**
 * Co právě dělá lokální katalog — vlevo dole (postranní panel i Nastavení):
 *  - dlouhá práce (první build / „Refresh everything") = zelená pilulka s průběhem,
 *  - běžná kontrola novinek = řádek se spinnerem „Checking for new charts…",
 *  - po dokončení na pár vteřin „Catalog up to date", pak zmizí.
 * V klidu nic neukazuje.
 */
export function CatalogActivity({ onOpen }: { onOpen?: () => void }): JSX.Element | null {
  const catalog = useStore((s) => s.catalogStatus)
  const syncing = catalog?.state === 'syncing'
  const [justDone, setJustDone] = useState(false)
  const wasSyncing = useRef(false)

  useEffect(() => {
    if (syncing) {
      wasSyncing.current = true
      setJustDone(false)
      return
    }
    if (!wasSyncing.current) return
    wasSyncing.current = false
    setJustDone(true)
    const t = setTimeout(() => setJustDone(false), 4000)
    return () => clearTimeout(t)
  }, [syncing])

  if (!catalog) return null

  if (syncing && catalog.longRun) {
    const pct = Math.round((catalog.progress ?? 0) * 100)
    const inner = (
      <>
        {/* Pilulka se plní zelenou zleva doprava (jako stahování updatu). */}
        <span className="side-catalog__fill" style={{ width: `${Math.max(4, pct)}%` }} aria-hidden="true" />
        <span className="side-catalog__text">
          {catalog.usable ? 'Updating catalog' : 'Building catalog'}
          <b>{pct}%</b>
        </span>
      </>
    )
    const title =
      "Chart Manager is downloading its local copy of both databases. Search keeps working meanwhile; filters get fast once it's done. Details in Settings → Maintenance."
    return onOpen ? (
      <button type="button" className="side-catalog" title={title} onClick={onOpen}>
        {inner}
      </button>
    ) : (
      <div className="side-catalog side-catalog--static" title={title}>
        {inner}
      </div>
    )
  }

  if (syncing) {
    return (
      <div className="catact" role="status" title="Looking for charts added or updated since the last check.">
        <span className="catact__spin" aria-hidden="true" />
        Checking for new charts…
      </div>
    )
  }

  // Hned při konci syncu (ještě před efektem níž), ať mezi stavy neblikne prázdno.
  const done = justDone || (!syncing && wasSyncing.current)
  if (done && catalog.usable) {
    return (
      <div className="catact catact--done" role="status">
        <Icon name="check" size={12} />
        Catalog up to date
      </div>
    )
  }

  return null
}
