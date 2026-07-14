import { create } from 'zustand'
import type {
  AppConfig,
  Database,
  DownloadJob,
  FilterOptions,
  RhythmVerseSystem,
  SearchFilters,
  SongResult,
  SortKey
} from '../../shared/types'
import { RV_CHUNK, RV_PAGE_CAP, isAutoDownloadable } from './utils'

export type { SortKey } from '../../shared/types'

interface AppState {
  query: string
  database: Database
  system: RhythmVerseSystem
  page: number
  records: number
  results: SongResult[]
  totalFiltered: number
  /** Počet do labelu „results found" (u „Both" = součet obou katalogů; jinak = totalFiltered). */
  resultCount: number
  loading: boolean
  error: string | null
  selectedIndex: number
  jobs: Record<string, DownloadJob>
  /** klíče písní, na které byl spuštěn download (pro UI stav tlačítka) */
  enqueuedKeys: Record<string, string> // songKey -> jobId
  config: AppConfig | null
  showSettings: boolean
  showLibrary: boolean
  /** Cíl pro „In library": relativní cesty (k Songs) kopií písně k odhalení v Library
   *  Manageru. null = manager otevřen normálně (kořen). Víc cest = duplikáty. */
  libraryReveal: string[] | null
  showWhatsNew: boolean
  /** Verze, ze které uživatel updatoval — changelog pak ukáže vše novější. null = ruční otevření (posledních N). */
  whatsNewSince: string | null
  /** Otevřený modal „Import playlist" (Spotify → charty). */
  showPlaylistImport: boolean

  // Filtr podle nástroje (id nástroje, který musí být zahraný)
  instrumentFilters: string[]
  // Filtr obtížnosti (0–6) aplikovaný na vybrané nástroje
  diffMin: number
  diffMax: number
  // Zpřesňující filtry přes načtené výsledky (contains, case-insensitive)
  charterFilter: string
  albumFilter: string
  // „Už mám v knihovně" — normalizované klíče písní + přepínač skrytí
  ownedKeys: Set<string>
  hideOwned: boolean
  // Řazení výsledků
  sort: SortKey

  // ── „Surprise me" ────────────────────────────────────────────────────────
  /** Zobrazuje se právě jedna náhodně vylosovaná písnička? Jakékoli běžné
   *  hledání/procházení tento režim zruší. */
  surprise: boolean

  // Oficiální DLC – dotaz na otevření obchodu
  marketplacePrompt: SongResult | null

  // Výběr cílové podsložky při stahování
  pendingSong: SongResult | null
  folders: string[]
  foldersLoading: boolean
  lastSubfolder: string

  // Multi-select (hromadné stažení) — klíče vybraných písní + čekající dávka.
  selectedKeys: string[]
  pendingBatch: SongResult[] | null
  // Hromadný lokální drop (víc souborů / složka) — čeká na výběr cílové složky.
  pendingLocalBatch: string[] | null

  // Klíč aktuálně otevřeného ⋮ menu (jen jedno najednou).
  openRowMenu: string | null

  // Drop zone — lokální soubor čekající na potvrzení (artist/title/subfolder).
  pendingLocal: {
    path: string
    fileName: string
    suggestedArtist: string
    suggestedTitle: string
  } | null

  // ── „Deep scan" ──────────────────────────────────────────────────────
  // Server neumí filtrovat podle nástroje/obtížnosti. Při zapnutém filtru se
  // proto stáhnou VŠECHNY stránky dotazu (do stropu), filtruje a stránkuje se
  // LOKÁLNĚ — shody jdou souvisle za sebou a počty stránek/výsledků sedí.
  deep: boolean
  deepSongs: SongResult[]
  deepScannedPages: number
  deepTotalPages: number
  deepLoading: boolean
  /** Dotaz měl víc stránek než strop — prohledán jen začátek (obří katalogy). */
  deepCapHit: boolean

  // ── Advanced filtry / browse ─────────────────────────────────────────────
  /** Serverové filtry z advanced panelu (žánr, rok, délka). Instrument se bere
   *  z `instrumentFilters`. Prázdné = běžné hledání (žádný browse). */
  filters: SearchFilters
  /** Volby do dropdownů (RhythmVerse číselník); null dokud se nenačtou. */
  filterOptions: FilterOptions | null
  /** Je advanced panel otevřený? */
  showFilters: boolean

  // ── Zvuková ukázka (poslech před stažením) ───────────────────────────────
  /** Klíč písně, jejíž ukázka je právě aktivní (načítá se / hraje). */
  previewKey: string | null
  previewState: 'idle' | 'loading' | 'playing' | 'unavailable' | 'error'
  /** „Interpret - Název", co se reálně spárovalo (pro popisek). */
  previewLabel: string | null
  /** Přehraje / zastaví 30s ukázku dané písně (lazy — stáhne se až na klik). */
  togglePreview: (song: SongResult) => Promise<void>
  stopPreview: () => void

  setQuery: (q: string) => void
  setDatabase: (d: Database) => void
  setSystem: (s: RhythmVerseSystem) => void
  toggleInstrumentFilter: (id: string) => void
  setDiffRange: (min: number, max: number) => void
  setCharterFilter: (v: string) => void
  setAlbumFilter: (v: string) => void
  setHideOwned: (v: boolean) => void
  loadOwnedKeys: () => Promise<void>
  setSort: (s: SortKey) => void
  /** „Surprise me" — vylosuje JEDNU náhodnou písničku z celého právě prohlíženého
   *  výběru (respektuje filtr nástroje) a zobrazí ji. */
  surpriseMe: () => void
  clearFilters: () => void
  // ── Advanced filtry ──
  /** Nastaví jeden filtr advanced panelu a hned přenačte výsledky (auto-apply). */
  setFilter: (key: keyof SearchFilters, values: string[]) => void
  /** Lazy načtení voleb filtrů z RhythmVerse číselníku (jednou). */
  loadFilterOptions: () => Promise<void>
  setShowFilters: (v: boolean) => void
  setSelectedIndex: (i: number) => void
  setShowSettings: (v: boolean) => void
  setShowLibrary: (v: boolean) => void
  /** Otevře Library Manager rovnou na dané písni (kopiích) a vybere ji. */
  openLibraryAt: (rels: string[]) => void
  setShowWhatsNew: (v: boolean) => void
  /** Otevře „What's new". `since` = z jaké verze uživatel přišel (null/nezadáno = posledních N). */
  openWhatsNew: (since?: string | null) => void
  setShowPlaylistImport: (v: boolean) => void
  doSearch: (page?: number) => Promise<void>
  /** Přepne stránku: v deep režimu lokálně, jinak server dotazem. */
  goToPage: (p: number) => void
  /** Spustí hledání konkrétního termínu (discovery chip). */
  pickSearch: (term: string) => Promise<void>
  openDownload: (song: SongResult) => Promise<void>
  confirmDownload: (subfolder: string) => Promise<void>
  cancelDownload: () => void
  // Multi-select
  toggleSelected: (key: string) => void
  setSelection: (keys: string[]) => void
  clearSelection: () => void
  openBatchDownload: (songs: SongResult[]) => Promise<void>
  confirmBatchDownload: (subfolder: string) => Promise<void>
  cancelBatchDownload: () => void
  // Hromadný lokální drop
  openLocalBatch: (paths: string[]) => Promise<void>
  confirmLocalBatch: (subfolder: string) => Promise<void>
  cancelLocalBatch: () => void
  openMarketplace: (song: SongResult) => void
  closeMarketplace: () => void
  setOpenRowMenu: (key: string | null) => void
  openLocalDrop: (path: string, fileName: string) => Promise<void>
  cancelLocalDrop: () => void
  confirmLocalDrop: (
    artist: string,
    title: string,
    subfolder: string
  ) => Promise<void>
  applyJobUpdate: (job: DownloadJob) => void
  clearFinishedJobs: () => Promise<void>
  loadConfig: () => Promise<void>
  saveConfig: (patch: Partial<AppConfig>) => Promise<void>
}

/** Známé suffixy a tagy v názvech souborů z kolovacích chartingových komunit. */
const NAME_TAG = /[_\s.-]?(?:PS|CH|RB|RB1|RB2|RB3|RB4|PS3|PS4|XBOX|Wii|Chart|v\d+|final|fixed|update|updated)$/i

/** "LostInTheEcho_PS.rar" → { artist: '', title: 'Lost In The Echo' } */
function parseFileName(fileName: string): { artist: string; title: string } {
  // Strip extension.
  let base = fileName.replace(/\.[^.]+$/, '')
  // Strip známé tagy (může jich být víc za sebou: "_PS_v2").
  let prev = ''
  while (prev !== base) {
    prev = base
    base = base.replace(NAME_TAG, '')
  }
  // Pokud je tam " - ", split na artist+title; jinak title = vše, artist = ''.
  const dashIdx = base.indexOf(' - ')
  let artist = ''
  let title = base
  if (dashIdx > 0 && dashIdx < base.length - 3) {
    artist = base.slice(0, dashIdx)
    title = base.slice(dashIdx + 3)
  }
  return { artist: humanize(artist), title: humanize(title) }
}

/** Normalizace pro fuzzy porovnání: lowercase, jen písmena a číslice. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Posoudí, jestli "Artist Title" z lookupu odpovídá tomu, co jsme parsovali
 * z názvu souboru. Stačí, aby složený `artistTitle` byl prefix našeho
 * `parsedTitle` (nebo naopak) — pak to považujeme za stejnou skladbu.
 */
function looksLikeSameSong(parsedTitle: string, artist: string, title: string): boolean {
  const a = norm(parsedTitle)
  const b = norm(`${artist} ${title}`)
  if (!a || !b) return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

/** "LinkinPark_lost_in_the.echo" → "Linkin Park lost in the echo" → kapitalizace. */
function humanize(s: string): string {
  if (!s) return ''
  return (
    s
      // CamelCase → "Camel Case" (boundary lowercase → UPPERCASE).
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      // ALLCAPS → "ALL CAPS" boundary
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      // _ a . jako separator slov
      .replace(/[_.]+/g, ' ')
      // víc mezer → jedna
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Debounce pro znovunačtení „In library" indexu po dávce instalací. */
let ownedReloadTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Sekvenční token hledání — ochrana proti závodu odpovědí. Pomalá odpověď ze
 * staršího požadavku (stránka 1) nesmí přepsat novější (stránka 2, jiný dotaz,
 * jiná databáze).
 * (Stejný vzor jako typeahead v SearchBar.)
 */
let searchSeq = 0

// Cache velkých serverových „chunků" RhythmVerse pro hluboké stránky (za 249.
// stranou). Klíč `sig` = kontext (dotaz/systém/řazení/filtry); při jeho změně se
// zahodí. Drží se jen pár posledních chunků (LRU), ať to neroste bez omezení.
let rvChunkCache: { sig: string; chunks: Map<number, SongResult[]>; total: number } | null = null

/**
 * RhythmVerse písničky pro danou DISPLAY stránku (page × records). Mělké stránky
 * (≤249) jdou přímo (rychlé); hlubší přes velký serverový chunk (RV stránkuje jen
 * do 249. strany), z něhož lokálně ukrojíme okno — chunky se cachují (LRU). Vrací
 * null, když byl request mezitím přebit (myReq !== searchSeq). Používá RhythmVerse
 * samotný i RV část „Both".
 */
async function rvPageItems(
  q: string,
  system: RhythmVerseSystem,
  sort: SortKey | undefined,
  filters: SearchFilters | undefined,
  page: number,
  records: number,
  myReq: number
): Promise<{ songs: SongResult[]; total: number } | null> {
  if (page <= RV_PAGE_CAP) {
    const res = await window.api.search(q, page, records, system, 'rhythmverse', filters, sort)
    if (myReq !== searchSeq) return null
    return { songs: res.songs, total: res.totalFiltered }
  }
  const sig = JSON.stringify([q, system, sort ?? null, filters ?? null])
  if (!rvChunkCache || rvChunkCache.sig !== sig) rvChunkCache = { sig, chunks: new Map(), total: 0 }
  const firstItem = (page - 1) * records
  const lastItem = firstItem + records - 1
  const firstChunk = Math.floor(firstItem / RV_CHUNK) + 1
  const lastChunk = Math.floor(lastItem / RV_CHUNK) + 1
  for (let c = firstChunk; c <= lastChunk; c++) {
    // RV neservíruje stránky > 249 (vrací přetečení) → takový chunk vynech; ta
    // část výsledků zůstane prázdná (u „Both" ji doplní jen Encore).
    if (c > RV_PAGE_CAP) continue
    if (rvChunkCache.chunks.has(c)) continue
    const cres = await window.api.search(q, c, RV_CHUNK, system, 'rhythmverse', filters, sort)
    if (myReq !== searchSeq) return null
    rvChunkCache.chunks.set(c, cres.songs)
    rvChunkCache.total = cres.totalFiltered
    if (rvChunkCache.chunks.size > 8) {
      const oldest = rvChunkCache.chunks.keys().next().value
      if (oldest !== undefined) rvChunkCache.chunks.delete(oldest)
    }
  }
  const out: SongResult[] = []
  for (let i = firstItem; i <= lastItem; i++) {
    const c = Math.floor(i / RV_CHUNK) + 1
    const arr = rvChunkCache.chunks.get(c)
    const off = i - (c - 1) * RV_CHUNK
    if (arr && off < arr.length) out.push(arr[off])
  }
  return { songs: out, total: rvChunkCache.total }
}

// ── Přehrávač zvukových ukázek (jeden sdílený na celou appku) ──────────────
// Jeden <Audio> element + cache blob URL podle klíče písně, ať se stejná ukázka
// nestahuje dvakrát. Blob cache má strop (ukázka ~0,5 MB), starší se uvolní.
let previewAudio: HTMLAudioElement | null = null
const previewBlobCache = new Map<string, string>()
/** Popisek „Interpret - Název" k ukázce (paralelně s blob cache), ať se při
 *  přehrání z cache neztratí. */
const previewLabelCache = new Map<string, string | null>()
const PREVIEW_BLOB_MAX = 40
/** Ukázky (hlavně iTunes) jsou hlasitě normalizované — přehráváme tišeji. */
const PREVIEW_VOLUME = 0.5

/** Přístup k sdílenému audio elementu (pro progress ring v aktivním řádku). */
export function getPreviewAudioEl(): HTMLAudioElement | null {
  return previewAudio
}

function stopPreviewAudio(): void {
  if (previewAudio) {
    previewAudio.pause()
    try {
      previewAudio.currentTime = 0
    } catch {
      /* některé stavy to nedovolí — nevadí */
    }
  }
}

export const useStore = create<AppState>((set, get) => {
  /** Filtr, který server NEUMÍ plně → nutný deep scan (nabalit stránky a
   *  filtrovat lokálně). RhythmVerse umí `instrument[]` i pro víc nástrojů (AND,
   *  ověřeno), takže jeden i víc nástrojů na RV = čistě serverově. Encore umí
   *  jen jeden nástroj (posílá se první), takže víc nástrojů na Encore/Both =
   *  deep scan. Obtížnostní tier server nefiltruje vůbec = deep scan. */
  const needsDeepScan = (): boolean => {
    const s = get()
    const tierNarrowed = s.diffMin > 0 || s.diffMax < 6
    const encoreMultiInstrument = s.database !== 'rhythmverse' && s.instrumentFilters.length > 1
    return tierNarrowed || encoreMultiInstrument
  }

  /** „Browse" režim: otevřený filtr panel NEBO nastavený advanced filtr. Pak se
   *  jede serverovým procházením katalogu (RhythmVerse `list` / Encore prázdný
   *  dotaz) se serverovými filtry, ne klientský deep scan. */
  const browseActive = (): boolean => {
    const s = get()
    const f = s.filters
    // Prázdný dotaz = vždy procházení katalogu (RhythmVerse `list` / Encore
    // browse), ať se výsledky nevysypou do prázdna při zavření panelu.
    return (
      s.showFilters ||
      !s.query.trim() ||
      !!(f.genre?.length || f.year?.length || f.decade?.length || f.songLength?.length)
    )
  }

  /** Serverové filtry pro dotaz = advanced panel (žánr/rok/délka) + instrument
   *  z chipů (RhythmVerse i Encore ho umí serverově). Vrátí undefined, když nic. */
  const buildServerFilters = (): SearchFilters | undefined => {
    const s = get()
    const f: SearchFilters = {}
    if (s.filters.genre?.length) f.genre = s.filters.genre
    if (s.filters.year?.length) f.year = s.filters.year
    if (s.filters.decade?.length) f.decade = s.filters.decade
    if (s.filters.songLength?.length) f.songLength = s.filters.songLength
    if (s.instrumentFilters.length) f.instrument = s.instrumentFilters
    return Object.keys(f).length ? f : undefined
  }

  /** Strop deep scanu: 40 stránek. Chrání před stahováním celé DB (~93k). */
  const DEEP_MAX_PAGES = 40
  /** Sken tahá po 100 (ne po `records`) → 40 stránek = 4000 písní pokrytí při
   *  stejném počtu requestů. Zobrazení pak stránkuje lokálně po `records`. */
  const DEEP_FETCH = 100

  /**
   * Stáhne postupně všechny stránky aktuálního dotazu (do stropu) a nabaluje
   * je do `deepSongs`. UI pak filtruje + stránkuje lokálně, takže shody jdou
   * souvisle za sebou (žádné poloprázdné stránky) a počty sedí.
   */
  const deepScan = async (): Promise<void> => {
    get().stopPreview() // změna filtrů přebuduje výsledky → ať nehraje ukázka „naslepo"
    const { query, database, system } = get()
    // Prázdný dotaz mimo browse (a mimo Encore) nemá co skenovat → vyčisti.
    // V browse (prázdný dotaz = katalog) pokračuj přes `list` endpoint.
    if (!query.trim() && database !== 'enchor' && !browseActive()) {
      searchSeq++
      set({ results: [], totalFiltered: 0, error: null, loading: false })
      return
    }
    const myReq = ++searchSeq
    set({
      deep: true,
      deepSongs: [],
      deepScannedPages: 0,
      deepTotalPages: 1,
      deepLoading: true,
      deepCapHit: false,
      loading: true,
      error: null,
      page: 1,
      selectedIndex: -1,
      selectedKeys: [],
      surprise: false
    })
    try {
      let totalPages = 1
      for (let p = 1; p <= Math.min(totalPages, DEEP_MAX_PAGES); p++) {
        const res = await window.api.search(
          query.trim(),
          p,
          DEEP_FETCH,
          system,
          database,
          buildServerFilters(),
          get().sort
        )
        if (myReq !== searchSeq) return // mezitím odstartovalo novější hledání
        const total = res.totalFiltered || res.songs.length
        totalPages = Math.max(1, Math.ceil(total / DEEP_FETCH))
        set((s) => {
          // Dedup napříč stránkami (v „Both" může tatáž píseň přijít z RV i
          // Encore na různých stránkách; IPC dedupuje jen v rámci jedné stránky).
          const seen = new Set(s.deepSongs.map((x) => x.key))
          const merged = s.deepSongs.concat(res.songs.filter((x) => !seen.has(x.key)))
          return {
            deepSongs: merged,
            deepScannedPages: p,
            deepTotalPages: Math.min(totalPages, DEEP_MAX_PAGES),
            totalFiltered: total,
            loading: false // od první stránky ukazujeme přibývající shody živě
          }
        })
        if (res.songs.length === 0) break
      }
      if (myReq !== searchSeq) return
      set({ deepLoading: false, deepCapHit: totalPages > DEEP_MAX_PAGES })
    } catch (e) {
      if (myReq !== searchSeq) return
      set({
        deepLoading: false,
        loading: false,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }

  /** Po změně filtrů zapne/vypne deep režim (a případně spustí sken). */
  const syncDeepMode = (): void => {
    // Po změně instrument/obtížnost filtru jen přenačti — `doSearch` sám vybere
    // server vs. deep scan a browse vs. prázdno.
    void get().doSearch(1)
  }

  return {
  query: '',
  database: 'rhythmverse',
  system: 'ch',
  page: 1,
  records: 25,
  results: [],
  totalFiltered: 0,
  resultCount: 0,
  loading: false,
  error: null,
  selectedIndex: -1,
  jobs: {},
  enqueuedKeys: {},
  config: null,
  showSettings: false,
  showLibrary: false,
  libraryReveal: null,
  showWhatsNew: false,
  whatsNewSince: null,
  showPlaylistImport: false,
  instrumentFilters: [],
  diffMin: 0,
  diffMax: 6,
  charterFilter: '',
  albumFilter: '',
  ownedKeys: new Set<string>(),
  hideOwned: false,
  sort: 'relevance',
  surprise: false,
  marketplacePrompt: null,
  pendingSong: null,
  folders: [],
  foldersLoading: false,
  lastSubfolder: '',
  selectedKeys: [],
  pendingBatch: null,
  pendingLocalBatch: null,
  openRowMenu: null,
  pendingLocal: null,
  deep: false,
  deepSongs: [],
  deepScannedPages: 0,
  deepTotalPages: 1,
  deepLoading: false,
  deepCapHit: false,
  filters: {},
  filterOptions: null,
  // Úvodní obrazovka = rovnou procházení katalogu, ale panel filtrů ZAVŘENÝ
  // (browse jede i tak — prázdný dotaz = katalog). Otevře se až na klik „Filters".
  showFilters: false,
  previewKey: null,
  previewState: 'idle',
  previewLabel: null,

  stopPreview: () => {
    stopPreviewAudio()
    set({ previewKey: null, previewState: 'idle', previewLabel: null })
  },

  togglePreview: async (song) => {
    const key = song.key
    const { previewKey, previewState } = get()

    // Klik na tutéž (hrající/načítající) ukázku = zastavit.
    if (previewKey === key && (previewState === 'playing' || previewState === 'loading')) {
      get().stopPreview()
      return
    }

    // Zastav cokoli, co zrovna hraje, a přepni cíl.
    stopPreviewAudio()
    set({ previewKey: key, previewState: 'loading', previewLabel: null })

    const ensureAudio = (): HTMLAudioElement => {
      if (!previewAudio) {
        previewAudio = new Audio()
        previewAudio.volume = PREVIEW_VOLUME
        previewAudio.addEventListener('ended', () => {
          // Doběhla-li stále aktivní ukázka, vrať tlačítko do „play".
          if (get().previewState === 'playing') set({ previewState: 'idle' })
        })
        previewAudio.addEventListener('error', () => {
          if (get().previewState === 'playing' || get().previewState === 'loading')
            set({ previewState: 'error' })
        })
      }
      return previewAudio
    }

    const play = (blobUrl: string, label: string | null): void => {
      if (get().previewKey !== key) return // uživatel mezitím přepnul
      const a = ensureAudio()
      a.src = blobUrl
      set({ previewState: 'playing', previewLabel: label })
      void a.play().catch(() => {
        if (get().previewKey === key) set({ previewState: 'error' })
      })
    }

    // Už staženo? Přehraj z cache.
    const cached = previewBlobCache.get(key)
    if (cached) {
      // Obnov LRU pořadí (přehrané = nejnovější), ať ho eviction neodstřihne.
      previewBlobCache.delete(key)
      previewBlobCache.set(key, cached)
      play(cached, previewLabelCache.get(key) ?? null)
      return
    }

    try {
      const res = await window.api.preview(song.artist, song.title)
      if (get().previewKey !== key) return // přepnuto během stahování
      if (!res.ok || !res.data) {
        set({ previewState: 'unavailable' })
        return
      }
      const blob = new Blob([res.data], { type: res.mime || 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      // Strop cache: uvolni nejstarší blob, ale NIKDY ten právě hrající — jinak
      // by se revoknul URL přehrávané ukázky a zvuk by spadl na error.
      if (previewBlobCache.size >= PREVIEW_BLOB_MAX) {
        const playingKey = get().previewKey
        for (const oldest of previewBlobCache.keys()) {
          if (oldest === playingKey) continue
          const oldUrl = previewBlobCache.get(oldest)
          if (oldUrl) URL.revokeObjectURL(oldUrl)
          previewBlobCache.delete(oldest)
          previewLabelCache.delete(oldest)
          break
        }
      }
      previewBlobCache.set(key, url)
      const label =
        res.matchedArtist && res.matchedTitle
          ? `${res.matchedArtist} - ${res.matchedTitle}`
          : null
      previewLabelCache.set(key, label)
      play(url, label)
    } catch {
      if (get().previewKey === key) set({ previewState: 'error' })
    }
  },

  setQuery: (q) => {
    set({ query: q })
    // Vyprázdnění dotazu ukončí deep režim — jinak by nad prázdným polem
    // zůstaly viset zfiltrované výsledky z předchozího dotazu (a další změna
    // filtru by pak deep-skenovala prázdný dotaz s prázdným výsledkem).
    if (!q.trim() && get().deep) {
      set({ deep: false, deepSongs: [], deepLoading: false, deepCapHit: false })
    }
  },
  setDatabase: (d) => {
    // Chorus Encore neumí žánr/rok/délku → při přepnutí na něj je vyčistíme, ať
    // odznáček „Filters" nelže a nezůstanou viset nefunkční filtry. Řazení podle
    // stažení taky Encore neumí → padni zpět na default, ať UI nelže.
    if (d === 'enchor') {
      set({
        database: d,
        filters: {},
        sort: get().sort === 'downloads' ? 'relevance' : get().sort
      })
    } else set({ database: d })
  },
  setSystem: (s) => {
    // Číselník filtrů (žánry/roky/délky) je pro každý systém jiný → vynutit
    // znovunačtení, ať v dropdownech nezůstanou hodnoty z předchozího systému.
    set({ system: s, filterOptions: null })
    void get().loadFilterOptions()
  },
  toggleInstrumentFilter: (id) => {
    set((s) => ({
      instrumentFilters: s.instrumentFilters.includes(id)
        ? s.instrumentFilters.filter((x) => x !== id)
        : [...s.instrumentFilters, id],
      selectedIndex: -1,
      page: s.deep ? 1 : s.page
    }))
    syncDeepMode()
  },
  setDiffRange: (min, max) => {
    set((s) => ({
      diffMin: Math.max(0, Math.min(6, Math.min(min, max))),
      diffMax: Math.max(0, Math.min(6, Math.max(min, max))),
      selectedIndex: -1,
      page: s.deep ? 1 : s.page
    }))
    syncDeepMode()
  },
  setCharterFilter: (v) => set({ charterFilter: v, selectedIndex: -1 }),
  setAlbumFilter: (v) => set({ albumFilter: v, selectedIndex: -1 }),
  setHideOwned: (v) => set({ hideOwned: v, selectedIndex: -1 }),
  loadOwnedKeys: async () => {
    try {
      const keys = await window.api.ownedSongKeys()
      set({ ownedKeys: new Set(keys) })
    } catch {
      /* nevadí — nápověda „In library" prostě nebude */
    }
  },
  // Řazení jde serverově (aby A-Z sedělo napříč VŠEMI stránkami, ne jen v rámci
  // jedné) → změna sortu přenačte od stránky 1. V deep režimu se tím přeskenuje
  // se správným server sortem, v „Both" navíc klient srovná sloučenou stránku.
  setSort: (s) => {
    set({ sort: s, selectedIndex: -1, page: 1 })
    void get().doSearch(1)
  },
  surpriseMe: async () => {
    get().stopPreview()
    const { query, system, database, records, sort } = get()
    // Serverové filtry (vč. nástroje) → losování respektuje zaškrtnuté nástroje.
    const filters = buildServerFilters()
    const myReq = ++searchSeq
    // results:[] → losování má vždy čistý stav; jediný pick, který surprise
    // vloží, je ten výsledný. Zabrání to „zaseknuté" staré písničce, kdyby bylo
    // losování přebito (rychlé přepnutí) nebo se zdrželo.
    set({ loading: true, error: null, surprise: true, selectedKeys: [], results: [] })
    try {
      // Kolik je výsledků v aktuálním výběru? Použij známý total (z browse), jinak
      // se zeptej. RhythmVerse `list` stránkuje max ~249 stránek bez ohledu na
      // `records`, takže hlubší písničky jdou dosáhnout jen přes VĚTŠÍ `records`.
      let total = get().totalFiltered
      if (!total || total < 1) {
        const probe = await window.api.search(query.trim(), 1, 1, system, database, filters, sort)
        if (myReq !== searchSeq) return
        total = probe.totalFiltered || probe.songs.length
      }
      if (!total || total < 1) {
        set({ loading: false, surprise: false, results: [], totalFiltered: 0 })
        return
      }
      // Každé API stránkuje jinak (ověřeno živě), takže velikost stránky i rozsah
      // losování volíme podle databáze:
      //  - RhythmVerse: `records` klidně velké, ale stránkuje jen do ~249. stránky
      //    → velké `pick`, aby se celý katalog vešel do ≤245 stránek.
      //  - Chorus Encore: `per_page` MAX 250, ale stránkuje do hloubky bez stropu
      //    → menší `pick` a náhodná stránka přes celý rozsah.
      //  - Both: sdílené per_page ≤250 (kvůli Encore) a stránka ≤245 (kvůli RV cap).
      let pick: number
      let maxPage: number
      if (database === 'enchor') {
        pick = Math.min(250, Math.max(records, 100))
        maxPage = Math.max(1, Math.ceil(total / pick))
      } else if (database === 'both') {
        pick = Math.min(250, Math.max(records, Math.ceil(total / 245)))
        maxPage = Math.max(1, Math.min(245, Math.ceil(total / pick)))
      } else {
        pick = Math.min(600, Math.max(records, Math.ceil(total / 245)))
        maxPage = Math.max(1, Math.min(245, Math.ceil(total / pick)))
      }
      const randPage = 1 + Math.floor(Math.random() * maxPage)
      const res = await window.api.search(query.trim(), randPage, pick, system, database, filters, sort)
      if (myReq !== searchSeq) return
      const pool = res.songs
      if (!pool.length) {
        set({ loading: false, surprise: false })
        return
      }
      const song = pool[Math.floor(Math.random() * pool.length)]
      set({
        results: [song],
        totalFiltered: res.totalFiltered || total,
        // U „Both" = kombinovaný počet (součet), ať „from N charts" sedí s labelem.
        resultCount: res.resultCount ?? res.totalFiltered ?? total,
        page: 1,
        deep: false,
        deepSongs: [],
        deepLoading: false,
        deepCapHit: false,
        surprise: true,
        loading: false,
        selectedIndex: 0
      })
    } catch (e) {
      if (myReq !== searchSeq) return
      set({ loading: false, surprise: false, error: e instanceof Error ? e.message : String(e) })
    }
  },
  /** Kanonický „clear all" — vyčistí VŠECHNY filtry (nástroj, obtížnost,
   *  žánr/rok/délka, charter, album, skrýt vlastněné) a přenačte. Volá ho jak
   *  chip v liště, tak tlačítko v panelu, ať mají stejný výsledek. */
  clearFilters: () => {
    set({
      instrumentFilters: [],
      diffMin: 0,
      diffMax: 6,
      charterFilter: '',
      albumFilter: '',
      hideOwned: false,
      filters: {},
      selectedIndex: -1
    })
    void get().doSearch(1)
  },
  setFilter: (key, values) => {
    set((s) => ({ filters: { ...s.filters, [key]: values }, page: 1, selectedIndex: -1 }))
    void get().doSearch(1)
  },
  loadFilterOptions: async () => {
    if (get().filterOptions) return
    try {
      const opts = await window.api.getFilterOptions(get().system)
      set({ filterOptions: opts })
    } catch {
      /* číselník nedostupný → panel prostě nebude mít předvyplněné volby */
    }
  },
  setShowFilters: (v) => {
    set({ showFilters: v })
    if (v) void get().loadFilterOptions()
    // Jen ukázat/schovat ovládání filtrů — výsledky necháváme být (procházení
    // běží dál, prázdný dotaz = katalog). Žádné vysypání do prázdna.
  },
  setSelectedIndex: (i) => set({ selectedIndex: i }),
  setShowSettings: (v) => set({ showSettings: v }),
  // Zavření manageru vyčistí cíl „reveal" (příště se otevře normálně na kořeni).
  // Zároveň obnoví „owned" index — uživatel mohl ve správci smazat/přesunout
  // písničky, jinak by řádky ve výsledcích držely zastaralý „In library".
  setShowLibrary: (v) => {
    set(v ? { showLibrary: true } : { showLibrary: false, libraryReveal: null })
    if (!v) void get().loadOwnedKeys()
  },
  openLibraryAt: (rels) => set({ libraryReveal: rels, showLibrary: true }),
  setShowWhatsNew: (v) => set({ showWhatsNew: v }),
  setShowPlaylistImport: (v) => set({ showPlaylistImport: v }),
  openWhatsNew: (since) => set({ showWhatsNew: true, whatsNewSince: since ?? null }),

  doSearch: async (page = 1) => {
    get().stopPreview() // nová sada výsledků → ať nehraje ukázka „naslepo"
    const { query, system, database, records } = get()
    const browsing = browseActive()
    // Prázdný dotaz normálně nic nehledá. Výjimky: Chorus Encore umí „browse all"
    // (prázdný dotaz vrátí celou databázi) a aktivní advanced filtry (RhythmVerse
    // `list` = procházení celého katalogu, volitelně zúžené filtry).
    if (!browsing && !query.trim() && database !== 'enchor') {
      searchSeq++ // zneplatní i případné běžící hledání
      set({ results: [], totalFiltered: 0, error: null, loading: false, deep: false, deepSongs: [], surprise: false })
      return
    }
    // Jen to, co server neumí (tier / Encore multi-nástroj) → deep scan.
    // Jeden nástroj i víc nástrojů na RhythmVerse zvládne server (AND) → jde
    // normální serverové stránkování s plným pokrytím a bez záplavy requestů.
    if (needsDeepScan()) {
      return deepScan()
    }
    const myReq = ++searchSeq
    // surprise:false → normální hledání (i po „Surprise me") ukáže skeleton, ne kostku.
    // Odcházíme-li z losování, zahoď i ten pick z results, ať při rychlém přepnutí
    // během animace (race / zdržený dotaz) nezůstane stará písnička viset nahoře.
    set({ loading: true, error: null, surprise: false, ...(get().surprise ? { results: [] } : {}) })
    try {
      // Serverové filtry posíláme VŽDY (i u textového hledání), ať se instrument
      // filtruje serverově, ne až klientsky nad stránkou.
      const filters = buildServerFilters()
      const sort = get().sort
      const q = query.trim()
      let songs: SongResult[]
      let total: number
      let rcount: number

      // RhythmVerse stránkuje jen do 249. serverové strany → HLUBŠÍ stránky (RV
      // samotný i RV část „Both") tahneme přes velký chunk a lokálně krájíme
      // (viz rvPageItems). Mělké stránky jdou přímo, rychle. Encore stránkuje do
      // hloubky sám. Tím jde proklikat celý katalog v obou režimech.
      if (database === 'both' && page > RV_PAGE_CAP) {
        // RV část přes chunk + Encore do hloubky, sloučit + odduplikovat STEJNĚ jako
        // ipc 'both'. allSettled (jako shallow ipc): když spadne jen jedna DB, ukaž
        // tu druhou; když obě, propaguj chybu.
        const [rvR, enR] = await Promise.allSettled([
          rvPageItems(q, system, sort, filters, page, records, myReq),
          window.api.search(q, page, records, system, 'enchor', filters, sort)
        ])
        if (myReq !== searchSeq) return
        if (rvR.status === 'rejected' && enR.status === 'rejected') {
          throw rvR.reason instanceof Error ? rvR.reason : new Error(String(rvR.reason))
        }
        const rv = rvR.status === 'fulfilled' ? rvR.value : null
        const enSongs = enR.status === 'fulfilled' ? enR.value.songs : []
        const enTot = enR.status === 'fulfilled' ? enR.value.totalFiltered : 0
        const seen = new Set<string>()
        const merged: SongResult[] = []
        const keyOf = (s: SongResult): string =>
          `${s.artist.trim().toLowerCase()}|${s.title.trim().toLowerCase()}|${(s.charter ?? '')
            .trim()
            .toLowerCase()}`
        for (const s of [...enSongs, ...(rv ? rv.songs : [])]) {
          const k = keyOf(s)
          if (seen.has(k)) continue
          seen.add(k)
          merged.push(s)
        }
        songs = merged
        total = Math.max(rv ? rv.total : 0, enTot)
        rcount = (rv ? rv.total : 0) + enTot
      } else if (database === 'rhythmverse' && page > RV_PAGE_CAP) {
        const rv = await rvPageItems(q, system, sort, filters, page, records, myReq)
        if (rv === null) return
        songs = rv.songs
        total = rv.total
        rcount = total
      } else {
        const res = await window.api.search(q, page, records, system, database, filters, sort)
        if (myReq !== searchSeq) return
        songs = res.songs
        total = res.totalFiltered
        rcount = res.resultCount ?? res.totalFiltered
      }

      // Poslední pojistka proti přebití — jednotná pro všechny větve (pokryje
      // i rhythmverse cestu, kde byly všechny chunky v cache = žádný await guard).
      if (myReq !== searchSeq) return
      set({
        results: songs,
        totalFiltered: total,
        resultCount: rcount,
        page,
        loading: false,
        selectedIndex: -1,
        selectedKeys: [], // nový výsledek → zruš předchozí výběr
        deep: false,
        deepSongs: [],
        deepLoading: false,
        deepCapHit: false,
        surprise: false
      })
    } catch (e) {
      if (myReq !== searchSeq) return
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  goToPage: (p) => {
    const s = get()
    s.stopPreview() // změna stránky → zastav ukázku (řádek zmizí ze zobrazení)
    if (s.deep) set({ page: Math.max(1, p), selectedIndex: -1 })
    else void s.doSearch(p)
  },

  pickSearch: async (term) => {
    set({ query: term })
    await get().doSearch(1)
  },

  openDownload: async (song) => {
    // „Auto" = neptat se, cestu určí šablona z nastavení (main ji aplikuje při
    // instalaci). Podsložku NEposíláme — jinak by se ruční volba z minula sčítala
    // se šablonou a chart by skončil jinde, než ukazuje náhled v Nastavení.
    // Zařazujeme rovnou (ne přes confirmDownload) — žádný fake `pendingSong`
    // a hlavně se nepřepíše `lastSubfolder`, ať ruční režim po vypnutí auta
    // pořád nabízí poslední zvolenou složku.
    if (get().config?.autoTargetFolder) {
      if (get().enqueuedKeys[song.key]) return // guard proti dvojkliku
      try {
        const jobId = await window.api.enqueueDownload(song, undefined)
        set((s) => ({ enqueuedKeys: { ...s.enqueuedKeys, [song.key]: jobId } }))
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
      }
      return
    }
    set({ pendingSong: song, foldersLoading: true })
    try {
      const folders = await window.api.listSongFolders()
      set({ folders, foldersLoading: false })
    } catch {
      set({ folders: [], foldersLoading: false })
    }
  },

  confirmDownload: async (subfolder) => {
    const song = get().pendingSong
    if (!song) return
    // Pending nulujeme HNED — držení Enteru / dvojklik by jinak zařadily
    // tutéž píseň vícekrát (guard proti opakovanému confirmu během await).
    set({ pendingSong: null, lastSubfolder: subfolder })
    try {
      const jobId = await window.api.enqueueDownload(song, subfolder || undefined)
      set((s) => ({ enqueuedKeys: { ...s.enqueuedKeys, [song.key]: jobId } }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  cancelDownload: () => set({ pendingSong: null }),

  // ---- Multi-select ----
  toggleSelected: (key) =>
    set((s) => ({
      selectedKeys: s.selectedKeys.includes(key)
        ? s.selectedKeys.filter((k) => k !== key)
        : [...s.selectedKeys, key]
    })),
  setSelection: (keys) => set({ selectedKeys: keys }),
  clearSelection: () => set({ selectedKeys: [] }),

  openBatchDownload: async (songs) => {
    const { enqueuedKeys } = get()
    // Jen auto-stažitelné a ještě nezařazené (přeskoč oficiální DLC, MEGA/Mediafire…).
    const downloadable = songs.filter((s) => isAutoDownloadable(s) && !enqueuedKeys[s.key])
    if (downloadable.length === 0) return
    // „Auto" → přeskoč výběr cíle, zařaď rovnou (viz `openDownload`).
    if (get().config?.autoTargetFolder) {
      set({ selectedKeys: [] })
      const newEntries: Record<string, string> = {}
      for (const song of downloadable) {
        try {
          const jobId = await window.api.enqueueDownload(song, undefined)
          newEntries[song.key] = jobId
        } catch {
          /* jednotlivé selhání nezastaví dávku */
        }
      }
      set((s) => ({ enqueuedKeys: { ...s.enqueuedKeys, ...newEntries } }))
      return
    }
    set({ pendingBatch: downloadable, foldersLoading: true })
    try {
      const folders = await window.api.listSongFolders()
      set({ folders, foldersLoading: false })
    } catch {
      set({ folders: [], foldersLoading: false })
    }
  },
  confirmBatchDownload: async (subfolder) => {
    const batch = get().pendingBatch
    if (!batch) return
    // Guard proti dvojímu confirmu (držení Enteru) — jinak by se celá dávka
    // zařadila dvakrát.
    set({ pendingBatch: null, selectedKeys: [], lastSubfolder: subfolder })
    const newEntries: Record<string, string> = {}
    for (const song of batch) {
      try {
        const jobId = await window.api.enqueueDownload(song, subfolder || undefined)
        newEntries[song.key] = jobId
      } catch {
        /* jednotlivé selhání nezastaví dávku */
      }
    }
    set((s) => ({ enqueuedKeys: { ...s.enqueuedKeys, ...newEntries } }))
  },
  cancelBatchDownload: () => set({ pendingBatch: null }),

  // ---- Hromadný lokální drop ----
  openLocalBatch: async (paths) => {
    if (paths.length === 0) return
    set({ pendingLocalBatch: paths, foldersLoading: true })
    try {
      const folders = await window.api.listSongFolders()
      set({ folders, foldersLoading: false })
    } catch {
      set({ folders: [], foldersLoading: false })
    }
  },
  confirmLocalBatch: async (subfolder) => {
    const paths = get().pendingLocalBatch
    if (!paths) return
    set({ pendingLocalBatch: null, lastSubfolder: subfolder }) // guard proti dvojímu confirmu
    try {
      const ids = await window.api.enqueueLocalBatch(paths, subfolder || undefined)
      set((s) => {
        const enqueuedKeys = { ...s.enqueuedKeys }
        ids.forEach((id, i) => {
          enqueuedKeys[`localbatch:${id}:${i}`] = id
        })
        return { enqueuedKeys }
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },
  cancelLocalBatch: () => set({ pendingLocalBatch: null }),

  openMarketplace: (song) => set({ marketplacePrompt: song }),
  closeMarketplace: () => set({ marketplacePrompt: null }),
  setOpenRowMenu: (key) => set({ openRowMenu: key }),

  openLocalDrop: async (path, fileName) => {
    // 1) Rychlá heuristika z názvu souboru (instantní prefill).
    let { artist, title } = parseFileName(fileName)

    // 2) Pokud je to .sng, můžeme přečíst přesná metadata z hlavičky (rychlé).
    try {
      const meta = await window.api.peekFileMeta(path)
      if (meta) {
        artist = meta.artist || artist
        title = meta.title || title
      }
    } catch {
      /* ignorovat — heuristika postačí */
    }

    // 3) Když nemáme artist ale máme aspoň 2 slova v title, zkusíme lookup
    // v databázi — nejlepší top match obvykle správně rozdělí artist+title.
    if (!artist && title.split(/\s+/).length >= 2) {
      try {
        const res = await window.api.search(title, 1, 3, 'ch', 'both')
        const top = res.songs[0]
        if (top && looksLikeSameSong(title, top.artist, top.title)) {
          artist = top.artist
          title = top.title
        }
      } catch {
        /* nevadí — heuristika ostane */
      }
    }

    set({
      pendingLocal: {
        path,
        fileName,
        suggestedArtist: artist,
        suggestedTitle: title
      },
      foldersLoading: true
    })
    try {
      const folders = await window.api.listSongFolders()
      set({ folders, foldersLoading: false })
    } catch {
      set({ folders: [], foldersLoading: false })
    }
  },
  cancelLocalDrop: () => set({ pendingLocal: null }),
  confirmLocalDrop: async (artist, title, subfolder) => {
    const pending = get().pendingLocal
    if (!pending) return
    // Sestavíme minimální SongResult pro install/pojmenování.
    const localSong: SongResult = {
      key: `local:${pending.path}`,
      fileId: null,
      songId: null,
      title: title.trim() || pending.suggestedTitle || 'Unknown title',
      artist: artist.trim() || 'Unknown artist',
      album: '',
      year: null,
      genre: '',
      lengthSeconds: null,
      albumArtUrl: null,
      difficulties: {},
      expertOnly: null,
      charter: null,
      source: 'Local file',
      gameFormat: null,
      gameFormats: [],
      needsConversion: false,
      official: false,
      downloadUrl: null,
      downloadPageUrl: null,
      externalUrl: null,
      sizeBytes: null,
      downloads: null
    }
    set({ pendingLocal: null, lastSubfolder: subfolder }) // guard proti dvojímu confirmu
    try {
      const jobId = await window.api.enqueueLocalFile(
        pending.path,
        localSong,
        subfolder || undefined
      )
      set((s) => ({ enqueuedKeys: { ...s.enqueuedKeys, [localSong.key]: jobId } }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  applyJobUpdate: (job) => {
    set((s) => ({ jobs: { ...s.jobs, [job.id]: job } }))
    // Auto-dismiss úspěšného downloadu po 5 sekundách jako lehká notifikace.
    // Chybové joby zůstávají, dokud uživatel nestiskne „Clear history" — chce
    // si přečíst, co se pokazilo.
    if (job.stage === 'done') {
      // Po instalaci osvěž „In library" index (debounced kvůli dávkám).
      if (ownedReloadTimer) clearTimeout(ownedReloadTimer)
      ownedReloadTimer = setTimeout(() => {
        void useStore.getState().loadOwnedKeys()
      }, 1500)
      setTimeout(() => {
        const cur = useStore.getState().jobs[job.id]
        if (!cur || cur.stage !== 'done') return // už ho mezitím něco změnilo
        useStore.setState((s) => {
          const { [job.id]: _gone, ...rest } = s.jobs
          // Zachovat enqueuedKeys u písní, jejichž job byl právě odstraněn,
          // jen vyčistit jeho mapování (UI tlačítko se vrátí na Download).
          const enqueuedKeys: typeof s.enqueuedKeys = {}
          for (const [k, id] of Object.entries(s.enqueuedKeys)) {
            if (id !== job.id) enqueuedKeys[k] = id
          }
          return { jobs: rest, enqueuedKeys }
        })
      }, 5000)
    }
  },

  clearFinishedJobs: async () => {
    await window.api.clearFinishedJobs()
    set((s) => {
      const jobs: typeof s.jobs = {}
      const removed = new Set<string>()
      for (const [id, j] of Object.entries(s.jobs)) {
        if (j.stage === 'done' || j.stage === 'error') removed.add(id)
        else jobs[id] = j
      }
      const enqueuedKeys: typeof s.enqueuedKeys = {}
      for (const [k, id] of Object.entries(s.enqueuedKeys)) {
        if (!removed.has(id)) enqueuedKeys[k] = id
      }
      return { jobs, enqueuedKeys }
    })
  },

  loadConfig: async () => {
    const config = await window.api.getConfig()
    set({ config, records: config.recordsPerPage })
  },

  saveConfig: async (patch) => {
    const prevRecords = get().records
    const config = await window.api.setConfig(patch)
    set({ config, records: config.recordsPerPage })
    // Změna „Results per page" → přenačti od stránky 1, jinak pager počítá
    // totalPages z nové hodnoty nad daty načtenými se starou.
    if (
      config.recordsPerPage !== prevRecords &&
      (get().results.length > 0 || get().deep)
    ) {
      void get().doSearch(1)
    }
  }
  }
})
