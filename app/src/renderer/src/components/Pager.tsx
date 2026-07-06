import { useStore } from '../store'
import { INSTRUMENTS } from '../utils'
import { Icon } from './Icon'

/** Vytvoří seznam stránek s výpustkami: [1,2,3,'…',9]. */
function pageList(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set<number>([1, total, current, current - 1, current + 1])
  if (current <= 3) [2, 3].forEach((n) => set.add(n))
  if (current >= total - 2) [total - 1, total - 2].forEach((n) => set.add(n))
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const n of nums) {
    if (prev && n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}

export function Pager({
  visibleCount,
  matchTotal
}: {
  visibleCount: number
  /** Deep režim: celkový počet SHOD po filtru (stránkuje se lokálně). */
  matchTotal?: number
}): JSX.Element {
  const page = useStore((s) => s.page)
  const records = useStore((s) => s.records)
  const totalFiltered = useStore((s) => s.totalFiltered)
  const instrumentFilters = useStore((s) => s.instrumentFilters)
  const diffMin = useStore((s) => s.diffMin)
  const diffMax = useStore((s) => s.diffMax)
  const clearFilters = useStore((s) => s.clearFilters)
  const goToPage = useStore((s) => s.goToPage)
  const deep = useStore((s) => s.deep)
  const deepLoading = useStore((s) => s.deepLoading)
  const deepScannedPages = useStore((s) => s.deepScannedPages)
  const deepTotalPages = useStore((s) => s.deepTotalPages)
  const deepCapHit = useStore((s) => s.deepCapHit)

  const totalPages = Math.max(1, Math.ceil((matchTotal ?? totalFiltered) / records))
  const diffActive = !(diffMin === 0 && diffMax === 6)
  const filtersActive = instrumentFilters.length > 0 || diffActive

  const chipParts: string[] = []
  if (instrumentFilters.length) {
    chipParts.push(
      instrumentFilters
        .map((id) => INSTRUMENTS.find((i) => i.id === id)?.label ?? id)
        .join(' + ')
    )
  }
  if (diffActive) {
    chipParts.push(diffMin === diffMax ? `Difficulty ${diffMin}` : `Difficulty ${diffMin}–${diffMax}`)
  }

  return (
    <div className="pager">
      <div className="pager__left">
        {filtersActive ? (
          <>
            <span className="filterchip">
              {chipParts.join(' · ')}
              <button className="filterchip__x" onClick={clearFilters} title="Clear filters">
                <Icon name="close" size={10} />
              </button>
            </span>
            <button className="pager__clear" onClick={clearFilters}>
              Clear Filters
            </button>
          </>
        ) : null}
      </div>

      <div className="pager__pages">
        <button className="pgbtn" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
          <Icon name="chevronLeft" size={14} />
        </button>
        {pageList(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="pgellipsis">
              …
            </span>
          ) : (
            <button
              key={p}
              className={`pgnum ${p === page ? 'pgnum--active' : ''}`}
              onClick={() => p !== page && goToPage(p)}
            >
              {p}
            </button>
          )
        )}
        <button className="pgbtn" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
          <Icon name="chevronRight" size={14} />
        </button>
      </div>

      <div className="pager__right">
        {deep ? (
          <>
            Page {page} / {totalPages} · {matchTotal} matches
            {deepLoading
              ? ` · scanning ${deepScannedPages}/${deepTotalPages}…`
              : deepCapHit
                ? ` · first ${deepTotalPages * records} results scanned`
                : ''}
          </>
        ) : (
          <>
            Page {page} / {totalPages} · {totalFiltered} results
            {instrumentFilters.length > 0 ? ` · ${visibleCount} shown` : ''}
          </>
        )}
      </div>
    </div>
  )
}
