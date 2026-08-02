import { useEffect, useRef, useState } from 'react'
import type { FilterOption } from '../../../shared/types'
import { useStore } from '../store'
import { Icon } from './Icon'

/**
 * Jednovýběrový select (id + label) laděný jako obecný `.dd`, s prázdnou volbou.
 * Menu se vykresluje bez ořezu (panel nemá overflow:hidden).
 */
function FilterSelect({
  label,
  placeholder,
  value,
  options,
  onChange
}: {
  label: string
  placeholder: string
  value: string
  options: FilterOption[]
  onChange: (v: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = options.find((o) => o.id === value)

  return (
    <label className="filterfield">
      <span className="filterfield__label">{label}</span>
      <div className={`dd dd--filter ${open ? 'dd--open' : ''}`} ref={ref}>
        <button type="button" className="dd__btn" onClick={() => setOpen((o) => !o)}>
          <span className={current ? '' : 'dd__placeholder'}>
            {current ? current.label : placeholder}
          </span>
          <Icon name="caret" size={11} className="dd__caret" />
        </button>
        {open ? (
          <ul className="dd__menu dd__menu--scroll" role="listbox">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === ''}
                className={`dd__item ${value === '' ? 'dd__item--sel' : ''}`}
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                {placeholder}
              </button>
            </li>
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  className={`dd__item ${o.id === value ? 'dd__item--sel' : ''}`}
                  onClick={() => {
                    onChange(o.id)
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
    </label>
  )
}

/** Textové zúžení (charter / album). S hotovým lokálním katalogem prohledává
 *  CELÉ katalogy obou DB (store → catalogQuery); do té doby jen zužuje načtené
 *  výsledky (klientský contains v App.tsx). */
function FilterText({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string
  value: string
  placeholder: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className="filterfield">
      <span className="filterfield__label">{label}</span>
      <input
        className="filterfield__input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/**
 * Jeden sjednocený filtrovací panel. Nahoře „browse" (žánr / rok / délka —
 * serverově, jen RhythmVerse), pod tím „refine" (charter / album / skrýt
 * vlastněné — klientsky nad načtenými výsledky, funguje i na Encore). Nahrazuje
 * dřívější samostatné „Refine" tlačítko v liště výsledků.
 */
export function FilterPanel(): JSX.Element {
  const show = useStore((s) => s.showFilters)
  const filters = useStore((s) => s.filters)
  const options = useStore((s) => s.filterOptions)
  const database = useStore((s) => s.database)
  const setFilter = useStore((s) => s.setFilter)
  const clearFilters = useStore((s) => s.clearFilters)
  const setDatabase = useStore((s) => s.setDatabase)
  const doSearch = useStore((s) => s.doSearch)

  const charter = useStore((s) => s.charterFilter)
  const album = useStore((s) => s.albumFilter)
  const hideOwned = useStore((s) => s.hideOwned)
  const reductions = useStore((s) => s.reductions)
  const directOnly = useStore((s) => s.directOnly)
  const setCharter = useStore((s) => s.setCharterFilter)
  const setAlbum = useStore((s) => s.setAlbumFilter)
  const setReductions = useStore((s) => s.setReductions)
  const catalog = useStore((s) => s.catalogStatus)

  // S hotovým lokálním katalogem umí žánr/rok/dekádu/délku i Chorus Encore
  // (filtruje se lokálně přes celý katalog) → banner „jen RhythmVerse" pryč.
  // Použitelnost je PER-ZDROJ: stačí dokončení Encore části, nečeká se na
  // RhythmVerse (zdroje se stahují paralelně, každý naskočí sám za sebe).
  const enReady = !!catalog?.sources.en.ready
  const dbReady =
    database === 'enchor'
      ? enReady
      : database === 'rhythmverse'
        ? !!catalog?.sources.rv.ready
        : !!catalog?.sources.rv.ready && enReady
  const encoreOnly = database === 'enchor' && !enReady
  const anyBrowse = !!(
    filters.genre?.length ||
    filters.year?.length ||
    filters.decade?.length ||
    filters.songLength?.length
  )
  const anyRefine = !!(charter || album || hideOwned) || reductions !== 'any' || directOnly
  const anyActive = anyBrowse || anyRefine

  const one = (key: 'genre' | 'year' | 'decade' | 'songLength'): string => filters[key]?.[0] ?? ''
  const set =
    (key: 'genre' | 'year' | 'decade' | 'songLength') =>
    (v: string): void =>
      setFilter(key, v ? [v] : [])

  // Vyčistí VŠECHNY filtry naráz (kanonický clear ve store — nástroj/obtížnost
  // i žánr/rok/délka/charter/album/hideOwned).
  const clearAll = (): void => clearFilters()

  // Overflow povolíme až PO dovysunutí rolety (jinak by se rozbalovací menu
  // ořezávalo o panel); při zavírání ho hned skryjeme, ať roleta pěkně zajede.
  const [expanded, setExpanded] = useState(show)
  useEffect(() => {
    if (!show) {
      setExpanded(false)
      return undefined
    }
    const t = setTimeout(() => setExpanded(true), 300)
    return () => clearTimeout(t)
  }, [show])

  return (
    <div className={`filterpanel ${show ? 'filterpanel--open' : ''}`} aria-hidden={!show}>
      <div className={`filterpanel__inner ${show && expanded ? 'filterpanel__inner--open' : ''}`}>
      {encoreOnly ? (
        <div className="filterpanel__encore">
          <Icon name="info" size={16} />
          {catalog?.state === 'syncing' ? (
            // Katalog se právě staví (jednorázově pár minut) → řekni, že filtry
            // doskočí samy, s průběhem ENCORE části. Řádka dole u charter/album
            // ukazuje TENTÝŽ per-databázový průběh, ať čísla sedí vedle sebe.
            <span>
              Filters will work for <strong>Chorus Encore</strong> once the local catalog is built
              — <strong>{Math.round((catalog.sources.en.progress ?? 0) * 100)}%</strong> done.
              Until then they browse RhythmVerse only.
            </span>
          ) : (
            <span>
              Genre, year, decade and length browsing uses <strong>RhythmVerse</strong>. Chorus
              Encore filters by instrument (buttons above).
            </span>
          )}
          <button
            type="button"
            className="filterpanel__switch"
            onClick={() => {
              setDatabase('rhythmverse')
              void doSearch(1)
            }}
          >
            Use RhythmVerse
          </button>
        </div>
      ) : (
        <div className="filterpanel__grid">
          <FilterSelect
            label="Genre"
            placeholder="Any genre"
            value={one('genre')}
            options={options?.genre ?? []}
            onChange={set('genre')}
          />
          <FilterSelect
            label="Release year"
            placeholder="Any year"
            value={one('year')}
            options={options?.year ?? []}
            onChange={set('year')}
          />
          <FilterSelect
            label="Decade"
            placeholder="Any decade"
            value={one('decade')}
            options={options?.decade ?? []}
            onChange={set('decade')}
          />
          <FilterSelect
            label="Song length"
            placeholder="Any length"
            value={one('songLength')}
            options={options?.songLength ?? []}
            onChange={set('songLength')}
          />
        </div>
      )}

      <div className="filterpanel__grid filterpanel__grid--refine">
        <FilterText label="Charter" value={charter} placeholder="e.g. Chezy" onChange={setCharter} />
        <FilterText label="Album" value={album} placeholder="e.g. Meteora" onChange={setAlbum} />
        {/* Redukce (Expert-only vs E/M/H/X) VEDLE Charter/Album ve stejné
            řadě, ať panel neroste na výšku. Přepínače vypadají jako odznaky
            u řádku výsledků; klik na aktivní ho vypne. */}
        <div className="filterfield">
          <span className="filterfield__label">Difficulty levels</span>
          <div className="reduc">
            <button
              type="button"
              className={`reduc__opt reduc__opt--expert ${reductions === 'expert' ? 'is-on' : ''}`}
              aria-pressed={reductions === 'expert'}
              onClick={() => setReductions(reductions === 'expert' ? 'any' : 'expert')}
            >
              Expert only
            </button>
            <button
              type="button"
              className={`reduc__opt reduc__opt--full ${reductions === 'full' ? 'is-on' : ''}`}
              aria-pressed={reductions === 'full'}
              onClick={() => setReductions(reductions === 'full' ? 'any' : 'full')}
            >
              E/M/H/X
            </button>
          </div>
        </div>
      </div>

      {/* Průběh stavby katalogu — JEN dokud pro vybranou databázi neběží
          naplno (hotový stav se nehlásí, prostě to funguje). Do té doby
          charter/album jen zužují načtenou stránku (staré chování). Procento
          je PER-DATABÁZE (stejné číslo jako v Encore banneru výš). */}
      {!dbReady && catalog?.state === 'syncing' ? (
        <div className="filterpanel__cat">
          Building local catalog…{' '}
          {Math.round(
            (database === 'enchor'
              ? catalog.sources.en.progress
              : database === 'rhythmverse'
                ? catalog.sources.rv.progress
                : (catalog.progress ?? 0)) * 100
          )}
          % — until it finishes, charter and album only narrow the loaded page.
        </div>
      ) : null}

      {/* „Hide songs I already have" a „Direct downloads only" žijí přímo
          v liště výsledků (vždy po ruce bez otevírání Filters) — viz App.tsx.
          Tady zůstává jen Clear filters (reset resetuje i ty přepínače). */}
      {anyActive ? (
        <div className="filterpanel__foot">
          <button type="button" className="filterpanel__clear" onClick={clearAll}>
            <Icon name="close" size={12} /> Clear filters
          </button>
        </div>
      ) : null}
      </div>
    </div>
  )
}
