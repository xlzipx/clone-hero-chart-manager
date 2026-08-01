import bugIcon from '../assets/bug.webp'
import { useStore } from '../store'
import { INSTRUMENTS, rvReachablePages } from '../utils'
import { Icon } from './Icon'

const ISSUES_URL = 'https://github.com/xlzipx/clone-hero-chart-manager/issues'

/**
 * Ikona „nahlásit chybu" v pravém rohu spodní lišty. Samostatná komponenta,
 * protože ji kromě pageru vykresluje i skeleton — jinak by ikona při každém
 * přepnutí databáze na dobu načítání zmizela.
 */
export function ReportBug(): JSX.Element {
  return (
    // Popis nese `title` (tooltip), stejně jako u dlaždic her v sidebaru.
    <button
      className="pager__bug"
      title="Report a bug"
      onClick={() => window.api.openExternal(ISSUES_URL)}
    >
      {/* Maska, ne <img>: předloha je ČERNÁ kresba na průhledném pozadí, na
          tmavém UI by zanikla. Přes masku barvu určuje CSS (viz AboutModal). */}
      <span
        className="pager__bugicon"
        style={{ WebkitMaskImage: `url("${bugIcon}")`, maskImage: `url("${bugIcon}")` }}
        aria-hidden="true"
      />
    </button>
  )
}

/**
 * Kolik stránek nabídnout na KAŽDOU stranu od aktuální. Dřív to byla jednička,
 * takže u velkých katalogů se dalo posouvat prakticky jen po jedné stránce.
 */
const PAGE_WINDOW = 3
/** Kolik čísel se vejde souvisle, než má smysl je zkracovat výpustkou. */
const PAGE_SOLID = PAGE_WINDOW * 2 + 3

/** Vytvoří seznam stránek s výpustkami: [1,'…',7,8,9,10,11,12,13,'…',826]. */
function pageList(current: number, total: number): (number | '…')[] {
  if (total <= PAGE_SOLID) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set<number>([1, total])
  for (let i = current - PAGE_WINDOW; i <= current + PAGE_WINDOW; i++) set.add(i)
  // U kraje se okno „opře" o začátek/konec — doplň chybějící čísla na druhou
  // stranu, ať je řada pořád stejně dlouhá a tlačítka neposkakují.
  if (current <= PAGE_WINDOW + 1) for (let i = 2; i <= PAGE_SOLID; i++) set.add(i)
  if (current >= total - PAGE_WINDOW) for (let i = total - PAGE_SOLID + 1; i < total; i++) set.add(i)
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
  const resultCount = useStore((s) => s.resultCount)
  const database = useStore((s) => s.database)
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

  // matchTotal != null = deep (lokální stránkování). Hluboké stránky RhythmVerse
  // (i RV část „Both") řeší chunkování ve store → plná hloubka. Samotný RhythmVerse
  // omez chunkovou kapacitou; Encore i Both jdou do plné hloubky.
  const rawPages = Math.max(1, Math.ceil((matchTotal ?? totalFiltered) / records))
  const rvReach = rvReachablePages(records)
  const totalPages =
    matchTotal != null
      ? rawPages
      : database === 'rhythmverse'
        ? Math.min(rvReach, rawPages)
        : rawPages
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
        <span>
          {deep ? (
            <>
              Page {page} / {totalPages} · {matchTotal} matches
              {deepLoading
                ? ` · scanning ${deepScannedPages}/${deepTotalPages}…`
                : deepCapHit
                  ? ` · first ${deepTotalPages * 100} scanned` /* 100 = DEEP_FETCH ve store */
                  : ''}
            </>
          ) : (
            <>
              Page {page} / {totalPages} · {resultCount || totalFiltered} results
              {instrumentFilters.length > 0 ? ` · ${visibleCount} shown` : ''}
            </>
          )}
        </span>
        <ReportBug />
      </div>
    </div>
  )
}
