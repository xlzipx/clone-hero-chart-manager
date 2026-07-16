import { useCallback, useEffect, useMemo, useRef } from 'react'
import { DownloadQueue } from './components/DownloadQueue'
import { FilterBar } from './components/FilterBar'
import { Icon } from './components/Icon'
import { LibraryManager } from './components/LibraryManager'
import { LocalDropModal } from './components/LocalDropModal'
import { MarketplaceModal } from './components/MarketplaceModal'
import { AboutModal } from './components/AboutModal'
import { PlaylistImportModal } from './components/PlaylistImportModal'
import { Pager } from './components/Pager'
import { SearchBar } from './components/SearchBar'
import { Sidebar } from './components/Sidebar'
import { Settings } from './components/Settings'
import { SongRow } from './components/SongRow'
import { SortSelect } from './components/SortSelect'
import { TargetFolderModal } from './components/TargetFolderModal'
import { TitleBar } from './components/TitleBar'
import { Discover } from './components/Discover'
import { WhatsNew } from './components/WhatsNew'
import { useStore } from './store'
import {
  INSTRUMENTS,
  RV_CHUNK,
  RV_PAGE_CAP,
  detectManualHost,
  isAutoDownloadable,
  songKey,
  stripTags
} from './utils'
import type { SongResult } from '../../shared/types'

/** Manuální host (MEGA/Mediafire/shortener) nejde spolehlivě auto-stáhnout —
 *  místo zařazení do fronty (kde by jen spadlo) otevřeme stránku v prohlížeči. */
function openSongExternal(song: SongResult): void {
  const url = song.downloadPageUrl || song.downloadUrl || song.externalUrl
  if (url) void window.api.openExternal(url)
}

export function App(): JSX.Element {
  const results = useStore((s) => s.results)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const page = useStore((s) => s.page)
  const records = useStore((s) => s.records)
  const totalFiltered = useStore((s) => s.totalFiltered)
  const resultCount = useStore((s) => s.resultCount)
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
  const ownedKeys = useStore((s) => s.ownedKeys)
  const hideOwned = useStore((s) => s.hideOwned)
  const sort = useStore((s) => s.sort)
  const surprise = useStore((s) => s.surprise)

  // Deep režim: filtr nástroje/obtížnosti → zdrojem je celý stažený dotaz
  // (všechny stránky) a stránkuje se lokálně nad shodami.
  const deep = useStore((s) => s.deep)
  const deepSongs = useStore((s) => s.deepSongs)
  const deepLoading = useStore((s) => s.deepLoading)
  const deepScannedPages = useStore((s) => s.deepScannedPages)
  const deepTotalPages = useStore((s) => s.deepTotalPages)
  const goToPage = useStore((s) => s.goToPage)
  const source = deep ? deepSongs : results

  // Klientský filtr + řazení (v deep režimu nad CELÝM dotazem).
  const filteredAll = useMemo(() => {
    // „Surprise" = jedna vylosovaná písnička; ukaž ji tak jak je (nástroj už
    // vyřešil server, tier/charter/album klientsky neaplikuj, ať nezmizí).
    if (surprise) return source
    const cf = charterFilter.trim().toLowerCase()
    const af = albumFilter.trim().toLowerCase()
    const diffNarrowed = diffMin > 0 || diffMax < 6
    const filtered = source.filter((song) => {
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
      // stripTags: filtr musí matchovat čistý text, ne <color=…> značky.
      if (cf && !stripTags(song.charter ?? '').toLowerCase().includes(cf)) return false
      if (af && !(song.album ?? '').toLowerCase().includes(af)) return false
      if (hideOwned && ownedKeys.has(songKey(song.artist, song.title))) return false
      return true
    })
    // Řazení jde PRIMÁRNĚ serverově (viz store + API klienti), takže stránky
    // sedí A-Z napříč celým katalogem, ne jen v rámci jedné stránky. Klientsky
    // dorovnáváme jen „Both" režim — tam se slučují dvě samostatně stránkované
    // databáze, které server globálně seřadit nedokáže. (downloads/newest klient
    // neumí — SongResult nemá to pole — tak se u nich necháme na server pořadí.)
    const clientSortable = sort === 'title' || sort === 'artist' || sort === 'length'
    if (database !== 'both' || !clientSortable) return filtered
    const arr = [...filtered]
    if (sort === 'title') arr.sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'artist')
      arr.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
    else arr.sort((a, b) => (b.lengthSeconds ?? 0) - (a.lengthSeconds ?? 0))
    return arr
  }, [
    source,
    surprise,
    database,
    instrumentFilters,
    diffMin,
    diffMax,
    charterFilter,
    albumFilter,
    hideOwned,
    ownedKeys,
    sort
  ])

  // Deep režim: stránkuje se lokálně nad shodami (25/str. dle nastavení),
  // takže počty stránek i výsledků odpovídají tomu, co je vidět.
  // Hluboké stránky RhythmVerse (i RV část „Both") řeší chunkování ve store →
  // proklikat jde celý katalog. Samotný RhythmVerse bezpečně omez chunkovou
  // kapacitou (249×RV_CHUNK); Encore i Both stránkují do plné hloubky; deep lokálně.
  const serverPages = Math.max(1, Math.ceil(totalFiltered / records))
  const rvReach = Math.floor((RV_PAGE_CAP * RV_CHUNK) / records)
  const totalPages = deep
    ? Math.max(1, Math.ceil(filteredAll.length / records))
    : database === 'rhythmverse'
      ? Math.min(rvReach, serverPages)
      : serverPages
  const pageClamped = deep ? Math.min(page, totalPages) : page
  const visible = useMemo(
    () =>
      deep ? filteredAll.slice((pageClamped - 1) * records, pageClamped * records) : filteredAll,
    [deep, filteredAll, pageClamped, records]
  )

  // Když filtr zúží počet stránek pod aktuální, vrať pager na poslední platnou.
  useEffect(() => {
    // Když se počet stránek zúží pod aktuální (filtr, nebo RV strop 249) → clamp.
    if (page > totalPages) goToPage(totalPages)
  }, [page, totalPages, goToPage])

  const setSelectedIndex = useStore((s) => s.setSelectedIndex)
  const openDownload = useStore((s) => s.openDownload)
  const openMarketplace = useStore((s) => s.openMarketplace)

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
  // Z vybraných reálně jen ty, které lze hromadně stáhnout (ne oficiální DLC,
  // ne MEGA/Mediafire, ne už ve frontě). Klik do řádku umí označit i nestažitelné,
  // takže počet i akce v liště se musí řídit tímhle, ne surovým `selectedCount`.
  const downloadableSelected = useMemo(
    () => visibleSelected.filter((s) => isAutoDownloadable(s) && !enqueuedKeys[s.key]),
    [visibleSelected, enqueuedKeys]
  )
  const downloadableCount = downloadableSelected.length
  const allChecked = checkableSongs.length > 0 && checkableSongs.every((s) => selectedSet.has(s.key))
  const toggleSelectAll = (): void => {
    if (allChecked) clearSelection()
    else setSelection(checkableSongs.map((s) => s.key))
  }
  const downloadSelected = (): void => {
    if (downloadableSelected.length > 0) void openBatchDownload(downloadableSelected)
  }

  // Akce „stáhnout" – oficiální DLC místo toho nabídne otevření obchodu.
  const triggerDownload = (song: (typeof results)[number]): void => {
    if (song.official) openMarketplace(song)
    else if (detectManualHost(song.source, song.downloadUrl || song.downloadPageUrl))
      openSongExternal(song)
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
  // Klik do řádku řídí výběr (stejný `selectedKeys` jako checkboxy → „Download
  // selected"): ctrl/meta = přepnout jednu, shift = rozsah od kotvy, jinak =
  // vybrat jen tuto. `selectedIndex` slouží jako kotva (a fokus pro klávesnici).
  const handleRowSelect = useCallback((key: string, ctrl: boolean, shift: boolean) => {
    const list = visibleRef.current
    const idx = list.findIndex((s) => s.key === key)
    if (idx < 0) return
    const st = useStore.getState()
    if (shift && st.selectedIndex >= 0) {
      const a = Math.min(st.selectedIndex, idx)
      const b = Math.max(st.selectedIndex, idx)
      st.setSelection(list.slice(a, b + 1).map((s) => s.key)) // kotva zůstává
    } else if (ctrl) {
      st.toggleSelected(key)
      st.setSelectedIndex(idx)
    } else if (st.selectedKeys.length === 1 && st.selectedKeys[0] === key) {
      // Druhý klik na tutéž (jedinou vybranou) → odznač.
      st.clearSelection()
      st.setSelectedIndex(-1)
    } else {
      st.setSelection([key])
      st.setSelectedIndex(idx)
    }
  }, [])
  const handleRowDownload = useCallback((key: string) => {
    const song = visibleRef.current.find((s) => s.key === key)
    if (!song) return
    const st = useStore.getState()
    if (song.official) st.openMarketplace(song)
    else if (detectManualHost(song.source, song.downloadUrl || song.downloadPageUrl))
      openSongExternal(song)
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
      // Úvodní obrazovka = rovnou procházení katalogu (RhythmVerse + Clone Hero,
      // panel filtrů otevřený). Je to jen jedna stránka (25 řádků) = jeden dotaz,
      // takže na start/výkon to nemá dopad. Číselník naplní dropdowny filtrů.
      void useStore.getState().loadFilterOptions()
      void useStore.getState().doSearch(1)
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
    // Seed rozdělané fronty: po reloadu rendereru je store.jobs prázdný a úloha
    // se sparse updaty (např. converting) by byla neviditelná do dalšího ticku.
    void window.api
      .getJobs()
      .then((js) => js.forEach(applyJobUpdate))
      .catch(() => {})
    const offHotkey = window.api.onHotkey((action) => {
      if (action === 'focus-search') {
        ;(document.querySelector('.searchbar input') as HTMLInputElement)?.focus()
      }
    })
    // Default v Electron rendereru je otevřít drop file ve výchozím prohlížeči — zabit.
    const stopDrag = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', stopDrag)
    window.addEventListener('drop', stopDrag)
    // Když se okno schová (uživatel jde hrát), zastav zvukovou ukázku —
    // ať nehraje hudba na pozadí, když appku nevidí.
    const onVis = (): void => {
      if (document.hidden) useStore.getState().stopPreview()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      offJob()
      offHotkey()
      window.removeEventListener('dragover', stopDrag)
      window.removeEventListener('drop', stopDrag)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [loadConfig, applyJobUpdate])

  // Klik mimo okno s výsledky → odznač vybraný řádek. (Uvnitř tabulky, v modalu
  // ani v našeptávači neodznačujeme.)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const st = useStore.getState()
      if (st.selectedIndex < 0 && st.selectedKeys.length === 0) return
      const t = e.target as HTMLElement | null
      // NEodznačuj jen na prvcích, kde s výběrem dál pracuješ (řádky, batch
      // tlačítko, select-all, sort, modal, našeptávač). Prázdné plochy lišty /
      // pageru / sidebaru / atd. výběr zruší.
      if (
        t?.closest('.tablewrap') ||
        t?.closest('.batchbar') ||
        t?.closest('.chk--selectall') ||
        t?.closest('.dd--sort') ||
        t?.closest('.modal-overlay') ||
        t?.closest('.suggest')
      )
        return
      st.setSelectedIndex(-1)
      st.clearSelection()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

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
        if (st.showAbout) st.setShowAbout(false)
        else if (st.showPlaylistImport) st.setShowPlaylistImport(false)
        else if (st.showWhatsNew) st.setShowWhatsNew(false)
        else if (st.showLibrary) st.setShowLibrary(false)
        else if (st.showSettings) {
          // Escape = Cancel: zahoď živý náhled UI scale (jinak by neuložená
          // škála zůstala aplikovaná až do restartu).
          void window.api.setUiScale(st.config?.uiScale ?? 1)
          st.setShowSettings(false)
        } else window.api.hideOverlay()
        return
      }
      // Otevřené Nastavení/Správce/What's new/Import/About: nech projít jen Escape (výše), nenaviguj.
      if (
        useStore.getState().showSettings ||
        useStore.getState().showLibrary ||
        useStore.getState().showWhatsNew ||
        useStore.getState().showPlaylistImport ||
        useStore.getState().showAbout
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
          else if (detectManualHost(song.source, song.downloadUrl || song.downloadPageUrl))
            openSongExternal(song)
          else if (!enqueuedKeys[song.key]) void openDownload(song)
        }
      } else if (e.key === 'PageDown') {
        if (page < totalPages) goToPage(page + 1)
      } else if (e.key === 'PageUp') {
        if (page > 1) goToPage(page - 1)
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
    goToPage
  ])

  // Scroll vybrané položky do view.
  useEffect(() => {
    document
      .querySelector('.song--selected')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  // Přepnutí stránky → seznam zpět nahoru (jinak zůstane odscrollovaný dole
  // z předchozí stránky; selectedIndex effect nepomůže, když už byl 0).
  useEffect(() => {
    document.querySelector('.results')?.scrollTo({ top: 0 })
  }, [page])

  return (
    <div className="app">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="workspace">
        <Sidebar />
        <main className="content">
      <TitleBar />
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

      <SearchBar />

      {source.length > 0 && !error ? (
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
            {surprise ? (
              <>
                <Icon name="dice" size={14} /> Surprise pick{' '}
                <span className="resultsbar__scan">
                  from {(resultCount || totalFiltered).toLocaleString('en-US')} charts — click Surprise me
                  again
                </span>
              </>
            ) : deep ? (
              // Deep režim: počítáme SHODY po filtru, ne surové výsledky serveru.
              <>
                <strong>{filteredAll.length}</strong> matching songs
                {query ? (
                  <>
                    {' for '}
                    <strong>“{query}”</strong>
                  </>
                ) : null}{' '}
                <span className="resultsbar__scan">
                  (filtered from {totalFiltered}
                  {deepLoading ? `, scanning ${deepScannedPages}/${deepTotalPages}…` : ''})
                </span>
              </>
            ) : (
              <>
                <strong>{resultCount || totalFiltered}</strong> results found
                {query ? (
                  <>
                    {' for '}
                    <strong>“{query}”</strong>
                  </>
                ) : null}
              </>
            )}
          </span>
          <div className="resultsbar__right">
            {/* Hromadná lišta má smysl až od 2 vybraných; u jedné stačí Download na řádku. */}
            {selectedCount > 1 ? (
              <div className="batchbar">
                <span className="batchbar__count">
                  {selectedCount} selected
                  {downloadableCount < selectedCount ? (
                    <span className="batchbar__note">
                      {downloadableCount > 0
                        ? `${downloadableCount} downloadable`
                        : 'none downloadable'}
                    </span>
                  ) : null}
                </span>
                <button
                  className="batchbar__dl"
                  onClick={downloadSelected}
                  disabled={downloadableCount === 0}
                  title={
                    downloadableCount === 0
                      ? 'None of the selected charts can be batch-downloaded — get those manually or from the store'
                      : undefined
                  }
                >
                  <Icon name="download" size={14} />{' '}
                  {downloadableCount > 0 && downloadableCount < selectedCount
                    ? `Download ${downloadableCount}`
                    : 'Download selected'}
                </button>
                <button className="batchbar__clear" onClick={clearSelection} title="Clear selection">
                  <Icon name="close" size={13} />
                </button>
              </div>
            ) : null}
            <SortSelect />
          </div>
        </div>
      ) : null}

      <div className="tablewrap">
      <div
        className={`results ${loading || (source.length > 0 && !error && visible.length > 0) ? 'results--table' : ''}`}
      >
        {loading ? (
          surprise ? (
            // „Surprise me" má vlastní tématickou animaci (převalující se kostka
            // v barvách nástrojů) místo generického shimmeru.
            <div className="surprise-load" aria-live="polite">
              <span className="surprise-load__dice" aria-hidden="true">
                <Icon name="dice" size={58} />
              </span>
              <div>
                <div className="surprise-load__label">Rolling the dice…</div>
                <div className="surprise-load__sub">Picking a chart at random</div>
              </div>
            </div>
          ) : (
            // Skeleton řádky (stejná mřížka jako .song → žádný skok, až dorazí data).
            <>
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="song song--skeleton" key={`sk-${i}`} aria-hidden="true">
                <span className="sk sk--check" />
                <span className="sk sk--art" />
                <div className="sk-main">
                  <span className="sk sk--title" />
                  <span className="sk sk--sub" />
                  <span className="sk sk--chips" />
                </div>
                <div className="sk-diffs">
                  {Array.from({ length: 5 }).map((_, d) => (
                    <span className="sk sk--diff" key={d} />
                  ))}
                </div>
                <span className="sk sk--btn" />
                <span className="sk sk--dots" />
              </div>
            ))}
            </>
          )
        ) : error ? (
          <div className="state state--error">⚠ {error}</div>
        ) : source.length === 0 ? (
          <div className="state state--empty">
            <div className="state__msg">
              {query
                ? 'Nothing found. Try a different search, or an artist below.'
                : 'Search for a song or artist.'}
            </div>
            <Discover />
          </div>
        ) : visible.length === 0 ? (
          <div className="state">
            {deep && deepLoading
              ? `No matches yet — scanning page ${deepScannedPages} of ${deepTotalPages}…`
              : 'No songs match the current filters. Try clearing a filter or Refine.'}
          </div>
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
      </div>

      {source.length > 0 && !surprise ? (
        <Pager visibleCount={visible.length} matchTotal={deep ? filteredAll.length : undefined} />
      ) : null}
        </main>
      </div>

      <DownloadQueue />
      <Settings />
      <TargetFolderModal />
      <MarketplaceModal />
      <LibraryManager />
      <LocalDropModal />
      <WhatsNew />
      <PlaylistImportModal />
      <AboutModal />
    </div>
  )
}
