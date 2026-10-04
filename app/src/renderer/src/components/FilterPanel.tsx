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

/**
 * Žánr jako text s našeptávačem (issue #15). Hledá se podle ČÁSTI názvu napříč
 * oběma databázemi: „funk" najde Funk, Funk Rock, R&B/Soul/Funk… Našeptávač
 * nabízí žánry, které v katalogu opravdu jsou, nejčastější první. Vyhledávání
 * se spustí s krátkou prodlevou po psaní (ne na každé písmeno), hned po výběru
 * z našeptávače, Enteru nebo opuštění pole.
 */
function GenreField({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState<{ label: string; count: number }[]>([])
  const [hi, setHi] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef(0)

  // Zvenku změněný filtr (Clear filters) → přepsat pole. Jen když se opravdu
  // liší, jinak by oříznutá hodnota smazala rozepsanou mezeru („hard ").
  useEffect(() => {
    setText((t) => (t.trim() === value ? t : value))
  }, [value])
  useEffect(() => {
    void window.api
      .catalogGenres()
      .then(setAll)
      .catch(() => setAll([]))
  }, [])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const commit = (v: string): void => {
    window.clearTimeout(timer.current)
    const t = v.trim()
    if (t !== value) onChange(t)
  }
  const q = text.trim().toLowerCase()
  const list = (q ? all.filter((g) => g.label.toLowerCase().includes(q)) : all).slice(0, 12)

  return (
    <label className="filterfield">
      <span className="filterfield__label">Genre</span>
      <div className={`dd dd--filter genrefield ${open && list.length ? 'dd--open' : ''}`} ref={ref}>
        <input
          className="filterfield__input"
          value={text}
          placeholder="e.g. Rock"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const v = e.target.value
            setText(v)
            setOpen(true)
            setHi(-1)
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => commit(v), 450)
          }}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setHi((h) => Math.min(h + 1, list.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHi((h) => Math.max(h - 1, -1))
            } else if (e.key === 'Enter') {
              const pick = hi >= 0 ? list[hi]?.label : text
              setText(pick ?? text)
              commit(pick ?? text)
              setOpen(false)
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
        {text ? (
          <button
            type="button"
            className="genrefield__clear"
            aria-label="Clear genre"
            onClick={() => {
              setText('')
              commit('')
            }}
          >
            <Icon name="close" size={11} />
          </button>
        ) : null}
        {open && list.length ? (
          <ul className="dd__menu dd__menu--scroll" role="listbox">
            {list.map((g, i) => (
              <li key={g.label}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === hi}
                  className={`dd__item genrefield__item ${i === hi ? 'dd__item--sel' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setText(g.label)
                    commit(g.label)
                    setOpen(false)
                  }}
                >
                  <span>{g.label}</span>
                  <span className="genrefield__count">{g.count.toLocaleString('en-US')}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </label>
  )
}

/** Předvolby filtru „Added / modified" (jako časový filtr v Googlu). */
const DATE_PRESETS: FilterOption[] = [
  { id: '1d', label: 'Past 24 hours' },
  { id: '7d', label: 'Past week' },
  { id: '30d', label: 'Past month' },
  { id: '90d', label: 'Past 3 months' },
  { id: '365d', label: 'Past year' },
  { id: 'custom', label: 'Custom range…' }
]

/** Textové zúžení (charter / artist). S hotovým lokálním katalogem prohledává
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
 * serverově, jen RhythmVerse), pod tím „refine" (charter / artist / skrýt
 * vlastněné — klientsky nad načtenými výsledky, funguje i na Encore). Nahrazuje
 * dřívější samostatné „Refine" tlačítko v liště výsledků.
 */
export function FilterPanel(): JSX.Element {
  const show = useStore((s) => s.showFilters)
  const filters = useStore((s) => s.filters)
  const options = useStore((s) => s.filterOptions)
  const database = useStore((s) => s.database)
  const setFilter = useStore((s) => s.setFilter)
  const setDatabase = useStore((s) => s.setDatabase)
  const doSearch = useStore((s) => s.doSearch)

  const charter = useStore((s) => s.charterFilter)
  const artist = useStore((s) => s.artistFilter)
  const reductions = useStore((s) => s.reductions)
  const setCharter = useStore((s) => s.setCharterFilter)
  const setArtist = useStore((s) => s.setArtistFilter)
  const setReductions = useStore((s) => s.setReductions)
  const catalog = useStore((s) => s.catalogStatus)
  const dateFilter = useStore((s) => s.dateFilter)
  const setDateFilter = useStore((s) => s.setDateFilter)
  // Budoucí data nemají smysl — kalendář je nenabídne.
  const today = new Date().toISOString().slice(0, 10)

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

  const one = (key: 'genre' | 'year' | 'decade' | 'songLength'): string => filters[key]?.[0] ?? ''
  const set =
    (key: 'genre' | 'year' | 'decade' | 'songLength') =>
    (v: string): void =>
      setFilter(key, v ? [v] : [])

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
            // doskočí samy, s průběhem ENCORE části. Řádka dole u charter/artist
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
      ) : null}

      {/* Jedna mřížka pro VŠECHNA pole (browse i refine) → na širokém okně se
          vejdou do jedné řádky a každé pole je kompaktní. S lokálním katalogem
          fungují žánr/rok/dekáda/délka i charter/artist stejně na obou DB, takže
          je nemá smysl vizuálně oddělovat. Když je Encore ještě bez katalogu
          (encoreOnly), browse pole ustoupí banneru a zůstane jen refine část. */}
      <div className="filterpanel__grid">
        <FilterSelect
          label="Added / modified"
          placeholder="Any time"
          value={dateFilter.preset === 'any' ? '' : dateFilter.preset}
          options={DATE_PRESETS}
          onChange={(v) =>
            setDateFilter({
              ...dateFilter,
              preset: (v || 'any') as typeof dateFilter.preset
            })
          }
        />
        {dateFilter.preset === 'custom' ? (
          <div className="filterfield filterfield--wide">
            <span className="filterfield__label">From – to</span>
            <div className="daterange">
              <input
                type="date"
                className="filterfield__input"
                value={dateFilter.from}
                max={dateFilter.to || today}
                onChange={(e) => setDateFilter({ ...dateFilter, from: e.target.value })}
              />
              <span className="daterange__sep">–</span>
              <input
                type="date"
                className="filterfield__input"
                value={dateFilter.to}
                min={dateFilter.from || undefined}
                max={today}
                onChange={(e) => setDateFilter({ ...dateFilter, to: e.target.value })}
              />
            </div>
          </div>
        ) : null}
        {encoreOnly ? null : (
          <>
            <FilterSelect
              label="Decade"
              placeholder="Any decade"
              value={one('decade')}
              options={options?.decade ?? []}
              onChange={set('decade')}
            />
            <FilterSelect
              label="Release year"
              placeholder="Any year"
              value={one('year')}
              options={options?.year ?? []}
              onChange={set('year')}
            />
            <FilterSelect
              label="Song length"
              placeholder="Any length"
              value={one('songLength')}
              options={options?.songLength ?? []}
              onChange={set('songLength')}
            />
          </>
        )}
        {/* Textová pole (žánr, charter, interpret) pohromadě vedle sebe. */}
        {encoreOnly ? null : <GenreField value={one('genre')} onChange={set('genre')} />}
        <FilterText label="Charter" value={charter} placeholder="e.g. Chezy" onChange={setCharter} />
        <FilterText label="Artist" value={artist} placeholder="e.g. Foo Fighters" onChange={setArtist} />
        {/* Redukce (Expert-only vs E/M/H/X) VEDLE Charter/Artist ve stejné
            řadě, ať panel neroste na výšku. Přepínače vypadají jako odznaky
            u řádku výsledků; klik na aktivní ho vypne. Trochu širší (dva
            přepínače v jedné buňce), ať se „Expert only" nemačká. */}
        <div className="filterfield filterfield--wide">
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
        {/* „Clear filters" žije v horní liště vedle tlačítka Filters (SearchBar) —
            jde tak filtry zrušit i bez otevření tohoto panelu. */}
      </div>

      {/* Průběh stavby katalogu — JEN dokud pro vybranou databázi neběží
          naplno (hotový stav se nehlásí, prostě to funguje). Do té doby
          charter/artist jen zužují načtenou stránku (staré chování). Procento
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
          % — until it finishes, charter and artist only narrow the loaded page.
        </div>
      ) : null}

      </div>
    </div>
  )
}
