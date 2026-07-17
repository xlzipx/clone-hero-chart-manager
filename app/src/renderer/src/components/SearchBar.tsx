import { useEffect, useRef, useState } from 'react'
import type { SongResult } from '../../../shared/types'
import { useStore } from '../store'
import { FilterPanel } from './FilterPanel'
import { Icon } from './Icon'

// Pozn. (redesign v2): Database/System přepínače žijí v levém Sidebaru.
// SearchBar je jen vyhledávací pole + našeptávač + tlačítko Search.

const SUGGEST_LIMIT = 7
const SUGGEST_DEBOUNCE_MS = 220

/** Mini album art s onError fallbackem (404 / CSP / chybějící obrázek). */
function SuggestArt({ url }: { url: string | null }): JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <Icon name="note" size={18} />
  return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
}

/** Zvýrazní prefix odpovídající dotazu (case-insensitive). */
function HighlightPrefix({ text, prefix }: { text: string; prefix: string }): JSX.Element {
  if (!prefix) return <>{text}</>
  const lower = text.toLowerCase()
  const lowerPrefix = prefix.toLowerCase()
  const idx = lower.indexOf(lowerPrefix)
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="suggest__hl">{text.slice(idx, idx + prefix.length)}</mark>
      {text.slice(idx + prefix.length)}
    </>
  )
}

export function SearchBar(): JSX.Element {
  const query = useStore((s) => s.query)
  const database = useStore((s) => s.database)
  const system = useStore((s) => s.system)
  const loading = useStore((s) => s.loading)
  const setQuery = useStore((s) => s.setQuery)
  const doSearch = useStore((s) => s.doSearch)
  const filters = useStore((s) => s.filters)
  const showFilters = useStore((s) => s.showFilters)
  const setShowFilters = useStore((s) => s.setShowFilters)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Typeahead state — drženo lokálně, aby se nemíchalo se skutečnými výsledky.
  const [suggest, setSuggest] = useState<SongResult[]>([])
  const [suggestTotal, setSuggestTotal] = useState(0)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(-1)
  const lastReqId = useRef(0)

  // Debounced fetch — zruš starší requesty přes rostoucí req-id.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      // Zruš případnou pending request bumpnutím id.
      lastReqId.current++
      setSuggest([])
      setSuggestTotal(0)
      setSuggestLoading(false)
      return
    }
    const myId = ++lastReqId.current
    setSuggestLoading(true)
    setSuggestError(false)
    const t = setTimeout(async () => {
      try {
        const res = await window.api.search(q, 1, SUGGEST_LIMIT, system, database)
        if (myId !== lastReqId.current) return // overtaken
        setSuggest(res.songs.slice(0, SUGGEST_LIMIT))
        // U „Both" ukazuj kombinovaný počet (součet) jako hlavní label, ne max.
        setSuggestTotal(res.resultCount ?? res.totalFiltered)
        setSuggestError(false)
      } catch {
        if (myId !== lastReqId.current) return
        setSuggest([])
        setSuggestTotal(0)
        setSuggestError(true) // odlišit selhání od legitimního „nic nenalezeno"
      } finally {
        if (myId === lastReqId.current) setSuggestLoading(false)
      }
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, system, database])

  // Klik mimo dropdown ho zavře.
  useEffect(() => {
    if (!suggestOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [suggestOpen])

  const runFullSearch = (): void => {
    setSuggestOpen(false)
    setHoverIdx(-1)
    doSearch(1)
  }

  const pick = (song: SongResult): void => {
    // Klik na návrh = filtruj na ten konkrétní titul (přesnost je věcí backendu).
    setQuery(song.title)
    setSuggestOpen(false)
    setHoverIdx(-1)
    // Re-run s novým textem (state update je async, takže předám přímo).
    setTimeout(() => doSearch(1), 0)
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      if (suggestOpen && hoverIdx >= 0 && hoverIdx < suggest.length) {
        e.preventDefault()
        pick(suggest[hoverIdx])
      } else {
        runFullSearch()
      }
      return
    }
    if (e.key === 'Escape') {
      // Když je otevřený našeptávač, Escape zavírá JEN jeho — nesmí propadnout
      // na window handler (ten by schoval celé okno aplikace).
      if (suggestOpen) e.stopPropagation()
      setSuggestOpen(false)
      setHoverIdx(-1)
      return
    }
    if (!suggestOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHoverIdx((i) => Math.min(i + 1, suggest.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHoverIdx((i) => Math.max(i - 1, -1))
    }
  }

  const showDropdown =
    suggestOpen &&
    query.trim().length >= 2 &&
    (suggestLoading || suggest.length > 0 || suggestTotal === 0)

  const activeFilterCount = (['genre', 'year', 'decade', 'songLength'] as const).filter(
    (k) => (filters[k]?.length ?? 0) > 0
  ).length

  return (
    <div className="searchbar">
      <div className="searchbar__row searchbar__row--input">
        <div className="searchbar__input-wrap" ref={wrapRef}>
          <div className="searchbar__input">
            <Icon name="search" size={16} className="searchbar__icon" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Search for a song or artist…"
              onChange={(e) => {
                setQuery(e.target.value)
                setSuggestOpen(true)
                setHoverIdx(-1)
              }}
              onFocus={() => {
                if (query.trim().length >= 2) setSuggestOpen(true)
              }}
              onKeyDown={onInputKey}
              autoFocus
            />
            {query ? (
              <button
                className="searchbar__clear"
                onClick={() => {
                  setQuery('')
                  setSuggest([])
                  setSuggestTotal(0)
                  setSuggestOpen(false)
                  inputRef.current?.focus()
                  // Prázdný dotaz → přenačti (browse katalogu / s aktivními filtry),
                  // ať nezůstane viset stará sada zfiltrovaná jen po stránce.
                  void doSearch(1)
                }}
              >
                <Icon name="close" size={13} />
              </button>
            ) : null}
          </div>

          {showDropdown ? (
            <div className="suggest" role="listbox">
              <div className="suggest__head">
                <span className="suggest__head-label">Top results</span>
                {suggestLoading ? (
                  <span className="suggest__head-meta">Searching…</span>
                ) : (
                  <span className="suggest__head-meta">{suggestTotal} total</span>
                )}
              </div>
              <div className="suggest__list">
                {suggest.length === 0 && !suggestLoading ? (
                  <div className="suggest__empty">
                    {suggestError ? "Couldn't load suggestions." : 'Nothing found.'}
                  </div>
                ) : (
                  suggest.map((song, i) => (
                    <button
                      // Index v klíči = pojistka proti duplicitnímu `song.key`
                      // (Encore umí vrátit tentýž chart 2×) → jinak React tříští
                      // reconciliation. Stejný princip jako u výsledků v App.tsx.
                      key={`${song.key}#${i}`}
                      className={`suggest__item ${i === hoverIdx ? 'suggest__item--hover' : ''}`}
                      onMouseEnter={() => setHoverIdx(i)}
                      onMouseLeave={() => setHoverIdx(-1)}
                      onClick={() => pick(song)}
                      role="option"
                      aria-selected={i === hoverIdx}
                    >
                      <span className="suggest__art">
                        <SuggestArt url={song.albumArtUrl} />
                      </span>
                      <span className="suggest__text">
                        <span className="suggest__title">
                          <HighlightPrefix text={song.title} prefix={query.trim()} />
                        </span>
                        <span className="suggest__sub">
                          {song.artist}
                          {song.year ? <> · {song.year}</> : null}
                          {song.charter ? <> · {song.charter}</> : null}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              {suggestTotal > suggest.length ? (
                <button className="suggest__all" onClick={runFullSearch}>
                  See all {suggestTotal} results →
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={`searchbar__filters ${showFilters ? 'searchbar__filters--open' : ''} ${
            activeFilterCount > 0 ? 'searchbar__filters--active' : ''
          }`}
          onClick={() => setShowFilters(!showFilters)}
          title="Advanced filters — browse by genre, year, decade and length"
        >
          <Icon name="filter" size={15} />
          <span>Filters</span>
          {activeFilterCount > 0 ? (
            <span className="searchbar__filters-badge">{activeFilterCount}</span>
          ) : null}
        </button>
        <button className="searchbar__go" onClick={runFullSearch} disabled={loading}>
          {loading ? '…' : 'Search'}
        </button>
      </div>
      <FilterPanel />
    </div>
  )
}
