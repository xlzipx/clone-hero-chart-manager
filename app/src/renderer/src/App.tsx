import { useCallback, useEffect, useMemo, useRef } from 'react'
import chLogoUrl from './assets/CHM_logo.png'
import { DownloadQueue } from './components/DownloadQueue'
import { FilterBar } from './components/FilterBar'
import { Icon } from './components/Icon'
import { LibraryManager } from './components/LibraryManager'
import { LocalDropModal } from './components/LocalDropModal'
import { MarketplaceModal } from './components/MarketplaceModal'
import { Pager } from './components/Pager'
import { SearchBar } from './components/SearchBar'
import { Settings } from './components/Settings'
import { RefineFilters } from './components/RefineFilters'
import { SongRow } from './components/SongRow'
import { SortSelect } from './components/SortSelect'
import { TargetFolderModal } from './components/TargetFolderModal'
import { TitleBar } from './components/TitleBar'
import { UpdateBanner } from './components/UpdateBanner'
import { Discover } from './components/Discover'
import { WhatsNew } from './components/WhatsNew'
import { useStore } from './store'
import { INSTRUMENTS, isAutoDownloadable, songKey } from './utils'

export function App(): JSX.Element {
  const results = useStore((s) => s.results)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const page = useStore((s) => s.page)
  const records = useStore((s) => s.records)
  const totalFiltered = useStore((s) => s.totalFiltered)
  const selectedIndex = useStore((s) => s.selectedIndex)
  const jobs = useStore((s) => s.jobs)
  const enqueuedKeys = useStore((s) => s.enqueuedKeys)
  const query = useStore((s) => s.query)
  const system = useStore((s) => s.system)
  const database = useStore((s) => s.database)
  const instrumentFilters = useStore((s) => s.instrumentFilters)
  const diffMin = useStore((s) => s.diffMin)
  const diffMax = useStore((s) => s.diffMax)
  const charterFilter = useStore((s) => s.charterFilter)
  const albumFilter = useStore((s) => s.albumFilter)
  const yearFilter = useStore((s) => s.yearFilter)
  const ownedKeys = useStore((s) => s.ownedKeys)
  const hideOwned = useStore((s) => s.hideOwned)
  const sort = useStore((s) => s.sort)

  // Klientský filtr + řazení.
  const visible = useMemo(() => {
    const cf = charterFilter.trim().toLowerCase()
    const af = albumFilter.trim().toLowerCase()
    const yf = yearFilter.trim()
    const diffNarrowed = diffMin > 0 || diffMax < 6
    const filtered = results.filter((song) => {
      if (instrumentFilters.length > 0) {
        // Vybrané nástroje musí být nacharované a v rozsahu obtížnosti.
        if (
          !instrumentFilters.every((id) => {
            const d = song.difficulties[id as keyof typeof song.difficulties]
            return d !== undefined && d >= diffMin && d <= diffMax
          })
        )
          return false
      } else if (diffNarrowed) {
        // Bez výběru nástroje: stačí, když JAKÝKOLI nástroj padne do rozsahu.
        const anyIn = INSTRUMENTS.some((inst) => {
          const d = song.difficulties[inst.id]
          return d !== undefined && d >= diffMin && d <= diffMax
        })
        if (!anyIn) return false
      }
      if (cf && !(song.charter ?? '').toLowerCase().includes(cf)) return false
      if (af && !(song.album ?? '').toLowerCase().includes(af)) return false
      if (yf && !String(song.year ?? '').includes(yf)) return false
      if (hideOwned && ownedKeys.has(songKey(song.artist, song.title))) return false
      return true
    })
    if (sort === 'relevance') return filtered
    const arr = [...filtered]
    if (sort === 'title') arr.sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'artist')
      arr.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
    else if (sort === 'length') arr.sort((a, b) => (b.lengthSeconds ?? 0) - (a.lengthSeconds ?? 0))
    return arr
  }, [
    results,
    instrumentFilters,
    diffMin,
    diffMax,
    charterFilter,
    albumFilter,
    yearFilter,
    hideOwned,
    ownedKeys,
    sort
  ])

  const setSelectedIndex = useStore((s) => s.setSelectedIndex)
  const openDownload = useStore((s) => s.openDownload)
  const openMarketplace = useStore((s) => s.openMarketplace)
  const doSearch = useStore((s) => s.doSearch)

  // Multi-select
  const selectedKeys = useStore((s) => s.selectedKeys)
  const setSelection = useStore((s) => s.setSelection)
  const clearSelection = useStore((s) => s.clearSelection)
  const openBatchDownload = useStore((s) => s.openBatchDownload)

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys])
  // Zaškrtnutelné = auto-stažitelné a ještě nezařazené do fronty.
  const checkableSongs = useMemo(
    () => visible.filter((s) => isAutoDownloadable(s) && !enqueuedKeys[s.key]),
    [visible, enqueuedKeys]
  )
  // Skutečně stažitelné vybrané položky (průnik výběru s aktuálně viditelnými) —
  // aby počet i akce seděly i po změně filtru nástroje.
  const visibleSelected = useMemo(
    () => visible.filter((s) => selectedSet.has(s.key)),
    [visible, selectedSet]
  )
  const selectedCount = visibleSelected.length
  const allChecked = checkableSongs.length > 0 && checkableSongs.every((s) => selectedSet.has(s.key))
  const toggleSelectAll = (): void => {
    if (allChecked) clearSelection()
    else setSelection(checkableSongs.map((s) => s.key))
  }
  const downloadSelected = (): void => {
    if (visibleSelected.length > 0) void openBatchDownload(visibleSelected)
  }

  // Akce „stáhnout" – oficiální DLC místo toho nabídne otevření obchodu.
  const triggerDownload = (song: (typeof results)[number]): void => {
    if (song.official) openMarketplace(song)
    else if (!enqueuedKeys[song.key]) void openDownload(song)
  }

  // Stabilní callbacky pro memoizované SongRow — memo komparátor callbacky
  // neporovnává, takže NESMÍ zachytávat index/píseň v closure (po přeřazení by
  // řádek držel starou hodnotu a klik by označil/stáhl jinou píseň). Řádek pošle
  // svůj klíč a tady si dohledáme AKTUÁLNÍ index/píseň přes ref.
  const visibleRef = useRef(visible)
  useEffect(() => {
    visibleRef.current = visible
  }, [visible])
  const handleRowSelect = useCallback((key: string) => {
    const idx = visibleRef.current.findIndex((s) => s.key === key)
    if (idx >= 0) useStore.getState().setSelectedIndex(idx)
  }, [])
  const handleRowDownload = useCallback((key: string) => {
    const song = visibleRef.current.find((s) => s.key === key)
    if (!song) return
    const st = useStore.getState()
    if (song.official) st.openMarketplace(song)
    else if (!st.enqueuedKeys[song.key]) void st.openDownload(song)
  }, [])
  const handleRowMarketplace = useCallback((key: string) => {
    const song = visibleRef.current.find((s) => s.key === key)
    if (song) useStore.getState().openMarketplace(song)
  }, [])
  const handleRowToggleCheck = useCallback((key: string) => {
    useStore.getState().toggleSelected(key)
  }, [])
  const applyJobUpdate = useStore((s) => s.applyJobUpdate)
  const loadConfig = useStore((s) => s.loadConfig)

  // Načtení configu + odběr událostí (úlohy, hotkeys).
  useEffect(() => {
    void (async () => {
      // try/catch: selhání loadConfig nesmí přerušit zbytek inicializace
      // (detekce Songs složky, „What's new").
      try {
        await loadConfig()
      } catch {
        /* config se načte znovu při otevření Nastavení */
      }
      // Index „už mám v knihovně" (nápověda ve výsledcích).
      void useStore.getState().loadOwnedKeys()
      // První spuštění mimo složku hry: pokud Songs neexistuje, otevři Nastavení.
      try {
        const exists = await window.api.songsDirExists()
        if (!exists) useStore.getState().setShowSettings(true)
      } catch {
        /* nevadí */
      }
      // Po aktualizaci (změna verze oproti minule) ukaž „What's new".
      try {
        const v = await window.api.appVersion()
        const last = localStorage.getItem('chm.lastSeenVersion')
        // Po updatu ukaž changelog VŠECH verzí novějších než ta, kterou měl minule
        // (ne jen té poslední) — ať vidí, co všechno se mezitím změnilo.
        if (last && last !== v) useStore.getState().openWhatsNew(last)
        localStorage.setItem('chm.lastSeenVersion', v)
      } catch {
        /* nevadí */
      }
    })()
    const offJob = window.api.onJobUpdate(applyJobUpdate)
    const offHotkey = window.api.onHotkey((action) => {
      if (action === 'focus-search') {
        ;(document.querySelector('.searchbar input') as HTMLInputElement)?.focus()
      }
    })
    // Default v Electron rendereru je otevřít drop file ve výchozím prohlížeči — zabit.
    const stopDrag = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', stopDrag)
    window.addEventListener('drop', stopDrag)
    return () => {
      offJob()
      offHotkey()
      window.removeEventListener('dragover', stopDrag)
      window.removeEventListener('drop', stopDrag)
    }
  }, [loadConfig, applyJobUpdate])

  const totalPages = Math.max(1, Math.ceil(totalFiltered / records))

  // Globální klávesová navigace v overlayi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'

      // Když je otevřený modal výběru složky, klávesy řeší samotný modal.
      if (useStore.getState().pendingSong) return
      if (useStore.getState().pendingBatch) return
      if (useStore.getState().pendingLocalBatch) return
      if (useStore.getState().pendingLocal) return
      // Dotaz na obchod (oficiální DLC): jen Escape zavře.
      if (useStore.getState().marketplacePrompt) {
        if (e.key === 'Escape') useStore.getState().closeMarketplace()
        return
      }

      if (e.key === 'Escape') {
        const st = useStore.getState()
        if (st.showWhatsNew) st.setShowWhatsNew(false)
        else if (st.showLibrary) st.setShowLibrary(false)
        else if (st.showSettings) {
          // Escape = Cancel: zahoď živý náhled UI scale (jinak by neuložená
          // škála zůstala aplikovaná až do restartu).
          void window.api.setUiScale(st.config?.uiScale ?? 1)
          st.setShowSettings(false)
        } else window.api.hideOverlay()
        return
      }
      // Otevřené Nastavení/Správce/What's new: nech projít jen Escape (výše), nenaviguj.
      if (
        useStore.getState().showSettings ||
        useStore.getState().showLibrary ||
        useStore.getState().showWhatsNew
      )
        return
      if (e.key === '/' && !typing) {
        e.preventDefault()
        ;(document.querySelector('.searchbar input') as HTMLInputElement)?.focus()
        return
      }
      if (typing) return

      const max = visible.length - 1
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(Math.min(selectedIndex + 1, max))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(Math.max(selectedIndex - 1, 0))
      } else if (e.key === 'Enter') {
        const song = visible[selectedIndex]
        if (song) {
          if (song.official) openMarketplace(song)
          else if (!enqueuedKeys[song.key]) void openDownload(song)
        }
      } else if (e.key === 'PageDown') {
        if (page < totalPages) void doSearch(page + 1)
      } else if (e.key === 'PageUp') {
        if (page > 1) void doSearch(page - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    visible,
    selectedIndex,
    page,
    totalPages,
    enqueuedKeys,
    setSelectedIndex,
    openDownload,
    openMarketplace,
    doSearch
  ])

  // Scroll vybrané položky do view.
  useEffect(() => {
    document
      .querySelector('.song--selected')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  return (
    <div className="app">
      <TitleBar />
      <UpdateBanner />
      <SearchBar />
      <FilterBar />

      {database !== 'enchor' && system !== 'ch' ? (
        <div className="rec-hint">
          <Icon name="info" size={14} />
          <span>
            For the most reliable downloads, use the <strong>Clone Hero</strong> tab. Phase Shift /
            Rock Band charts are often hosted on MEGA or Mediafire and may need manual download.
          </span>
        </div>
      ) : null}
      {database === 'enchor' ? (
        <div className="rec-hint">
          <Icon name="info" size={14} />
          <span>
            <strong>Chorus Encore</strong>: curated Clone Hero charts. Most download directly as
            a <code>.sng</code> from Encore, so usually no Google Drive or MEGA step.
          </span>
        </div>
      ) : null}

      {results.length > 0 && !loading && !error ? (
        <div className="resultsbar">
          {checkableSongs.length > 0 ? (
            <label className="chk chk--selectall" title="Select all downloadable songs">
              <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} />
              <span className="chk__box">
                <Icon name="check" size={12} />
              </span>
              <span className="chk__label">All</span>
            </label>
          ) : null}
          <span className="resultsbar__count">
            <strong>{totalFiltered}</strong> results found
            {query ? (
              <>
                {' for '}
                <strong>“{query}”</strong>
              </>
            ) : null}
          </span>
          <div className="resultsbar__right">
            {selectedCount > 0 ? (
              <div className="batchbar">
                <span className="batchbar__count">{selectedCount} selected</span>
                <button className="batchbar__dl" onClick={downloadSelected}>
                  <Icon name="download" size={14} /> Download selected
                </button>
                <button className="batchbar__clear" onClick={clearSelection} title="Clear selection">
                  <Icon name="close" size={13} />
                </button>
              </div>
            ) : null}
            <RefineFilters />
            <SortSelect />
          </div>
        </div>
      ) : null}

      <div className="results">
        {loading ? (
          <div className="state">Searching…</div>
        ) : error ? (
          <div className="state state--error">⚠ {error}</div>
        ) : results.length === 0 ? (
          <div className="state state--empty">
            <img className="ch-logo" src={chLogoUrl} alt="" draggable={false} />
            <div className="state__msg">
              {query
                ? 'Nothing found. Try a random pick or an artist below.'
                : 'Search for a song or artist, or let it surprise you.'}
            </div>
            <Discover />
          </div>
        ) : visible.length === 0 ? (
          <div className="state">No song matches the instrument filter.</div>
        ) : (
          visible.map((song, i) => (
            <SongRow
              key={song.key}
              song={song}
              selected={i === selectedIndex}
              owned={ownedKeys.has(songKey(song.artist, song.title))}
              checked={selectedSet.has(song.key)}
              checkable={isAutoDownloadable(song) && !enqueuedKeys[song.key]}
              onToggleCheck={handleRowToggleCheck}
              job={enqueuedKeys[song.key] ? jobs[enqueuedKeys[song.key]] : undefined}
              onSelect={handleRowSelect}
              onDownload={handleRowDownload}
              onMarketplace={handleRowMarketplace}
            />
          ))
        )}
      </div>

      {results.length > 0 && !loading ? <Pager visibleCount={visible.length} /> : null}

      <DownloadQueue />
      <Settings />
      <TargetFolderModal />
      <MarketplaceModal />
      <LibraryManager />
      <LocalDropModal />
      <WhatsNew />
    </div>
  )
}
