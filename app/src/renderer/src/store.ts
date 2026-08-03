import { create } from 'zustand'
import type {
  AppConfig,
  CatalogStatus,
  Database,
  DownloadJob,
  FilterOptions,
  RhythmVerseSystem,
  SearchFilters,
  SongResult,
  SortDir,
  SortKey
} from '../../shared/types'
import { SORT_DEFAULT_DIR } from '../../shared/types'
import { mergeBoth, songKey } from '../../shared/songid'
import { asError, errMsg, userMsg } from '../../shared/errors'
import {
  ENCORE_PER_PAGE_MAX,
  RV_CHUNK,
  RV_PAGE_CAP,
  RV_SURPRISE_MAX_PAGE,
  RV_SURPRISE_PICK,
  isAutoDownloadable
} from './utils'

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
  /** Otevřené okno „About" (klik na logo v titlebaru). */
  showAbout: boolean

  // Filtr podle nástroje (id nástroje, který musí být zahraný)
  instrumentFilters: string[]
  // Filtr obtížnosti (0–6) aplikovaný na vybrané nástroje
  diffMin: number
  diffMax: number
  // Zpřesňující filtry přes načtené výsledky (contains, case-insensitive)
  charterFilter: string
  albumFilter: string
  // Filtr redukcí: 'any' = bez omezení, 'expert' = jen Expert-only, 'full' = jen E/M/H/X
  reductions: 'any' | 'expert' | 'full'
  // Jen přímo stažitelné (skryje official DLC a MEGA/Mediafire) — týká se hlavně RhythmVerse
  directOnly: boolean
  // „Už mám v knihovně" — normalizované klíče písní + přepínač skrytí
  ownedKeys: Set<string>
  hideOwned: boolean
  // Řazení výsledků
  sort: SortKey
  /** Směr řazení. Výchozí je odvozen z klíče (SORT_DEFAULT_DIR); uživatel ho
   *  může přepnout šipkou nezávisle na klíči. */
  sortDir: SortDir
  /** true = uživatel sort AKTIVNĚ zvolil z menu; false = jede výchozí a tlačítko
   *  má stále ukazovat „Sort by" místo konkrétní volby. */
  sortTouched: boolean

  // ── „Surprise me" ────────────────────────────────────────────────────────
  /** Zobrazuje se právě jedna náhodně vylosovaná písnička? Jakékoli běžné
   *  hledání/procházení tento režim zruší. */
  surprise: boolean

  // Oficiální DLC – dotaz na otevření obchodu
  marketplacePrompt: SongResult | null

  // Výběr cílové podsložky při stahování
  pendingSong: SongResult | null
  folders: string[]
  /** Počty písní v nabízených složkách (dotahují se na pozadí; prázdné = ještě nedorazily). */
  folderCounts: Record<string, number>
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
  /** Stav lokálního katalogu metadat (null dokud nedorazí první status). */
  catalogStatus: CatalogStatus | null
  /** Napojí odběr stavu katalogu (volat jednou při mountu App). */
  watchCatalog: () => void

  // ── Zvuková ukázka (poslech před stažením) ───────────────────────────────
  /** Klíč písně, jejíž ukázka je právě aktivní (načítá se / hraje). */
  previewKey: string | null
  previewState: 'idle' | 'loading' | 'playing' | 'unavailable' | 'error'
  /** „Interpret - Název", co se reálně spárovalo (pro popisek). */
  previewLabel: string | null
  /** Přehraje / zastaví 30s ukázku dané písně (lazy — stáhne se až na klik). */
  togglePreview: (song: SongResult) => Promise<void>
  /**
   * Ukázka písně, kterou už máme v knihovně — hraje SKUTEČNÝ zvuk chartu
   * (u stopově dělených se všechny stopy pustí naráz). `key` odlišuje tlačítka
   * mezi sebou, `folderAbs` je složka písně.
   */
  toggleLocalPreview: (key: string, rel: string) => Promise<void>
  stopPreview: () => void

  setQuery: (q: string) => void
  setDatabase: (d: Database) => void
  setSystem: (s: RhythmVerseSystem) => void
  toggleInstrumentFilter: (id: string) => void
  setDiffRange: (min: number, max: number) => void
  setCharterFilter: (v: string) => void
  setAlbumFilter: (v: string) => void
  setReductions: (v: 'any' | 'expert' | 'full') => void
  setDirectOnly: (v: boolean) => void
  setHideOwned: (v: boolean) => void
  loadOwnedKeys: () => Promise<void>
  setSort: (s: SortKey) => void
  setSortDir: (d: SortDir) => void
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
  setShowAbout: (v: boolean) => void
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
  cancelJob: (id: string) => Promise<void>
  cancelAllJobs: () => Promise<void>
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

/** Debounce přehledání při psaní do charter/album filtru (katalogový režim). */
let refineTimer: ReturnType<typeof setTimeout> | null = null
function clearRefineTimer(): void {
  if (refineTimer !== null) {
    clearTimeout(refineTimer)
    refineTimer = null
  }
}
function scheduleRefineSearch(get: () => AppState): void {
  clearRefineTimer()
  refineTimer = setTimeout(() => {
    refineTimer = null
    void get().doSearch(1)
  }, 300)
}
/**
 * Změna charter/album filtru → přehledání. Psaní se debouncuje (300 ms, ať se
 * nehledá na každý stisk), ale VYMAZÁNÍ do prázdna se řeší OKAMŽITĚ: jinak by
 * `filtersNarrow` v UI spadl na false hned, kdežto úklid výsledků až za 300 ms,
 * a v té mezeře by na RhythmVerse/Both (bez dotazu) problikl prázdný Discover.
 */
function runRefineSearch(get: () => AppState, value: string): void {
  if (value.trim() === '') {
    clearRefineTimer()
    void get().doSearch(1)
  } else {
    scheduleRefineSearch(get)
  }
}

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
  sortDir: SortDir | undefined,
  filters: SearchFilters | undefined,
  page: number,
  records: number,
  myReq: number
): Promise<{ songs: SongResult[]; total: number } | null> {
  if (page <= RV_PAGE_CAP) {
    const res = await window.api.search(q, page, records, system, 'rhythmverse', filters, sort, sortDir)
    if (myReq !== searchSeq) return null
    return { songs: res.songs, total: res.totalFiltered }
  }
  // Směr je součást signatury cache — jinak by přepnutí A-Z/Z-A vracelo staré chunky.
  const sig = JSON.stringify([q, system, sort ?? null, sortDir ?? null, filters ?? null])
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
    const cres = await window.api.search(q, c, RV_CHUNK, system, 'rhythmverse', filters, sort, sortDir)
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
// ── Cache stránek deep scanu ─────────────────────────────────────────────
// Deep scan stahuje desítky stránek, ale obtížnostní tier se filtruje až
// LOKÁLNĚ (server ho neumí). Přepnutí obtížnosti je tedy pro server TENTÝŽ
// dotaz — klíč proto skládáme jen z toho, co se na server reálně posílá.
// Tier v něm být NESMÍ, jinak by cache minula přesně v tom případě, kvůli
// kterému vznikla.
interface DeepPage {
  songs: SongResult[]
  /** `totalFiltered` z odpovědi — určuje, kolik stránek se ještě má stáhnout. */
  total: number
}
const deepPageCache = new Map<string, DeepPage>()
/** Strop v počtu stránek. Jeden sken je max 40, takže se vejde ~5 dotazů. */
const DEEP_CACHE_MAX = 200

function deepCacheGet(key: string): DeepPage | undefined {
  const hit = deepPageCache.get(key)
  if (hit) {
    deepPageCache.delete(key) // obnov LRU pořadí (použité = nejnovější)
    deepPageCache.set(key, hit)
  }
  return hit
}

function deepCacheSet(key: string, page: DeepPage): void {
  deepPageCache.delete(key)
  deepPageCache.set(key, page)
  while (deepPageCache.size > DEEP_CACHE_MAX) {
    const oldest = deepPageCache.keys().next().value
    if (oldest === undefined) break
    deepPageCache.delete(oldest)
  }
}

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

// --- Ukázka písně, kterou UŽ MÁME v knihovně (Library manager, duplikáty) ---
// Hraje se skutečný zvuk chartu přes `chm-audio://`. Charty bývají rozdělené na
// stopy, takže elementů je víc a musí běžet SOUČASNĚ — samotné `song.ogg` je
// u takového chartu jen doprovod bez nástrojů.
let localEls: HTMLAudioElement[] = []
/** Časovač, který ukázku utne po 30 s (lokální soubor je celá píseň). */
let localTimer: number | null = null
/** Okno přehrávané ukázky v sekundách — kroužek se počítá z něj, ne z délky písně. */
let localWindow: { start: number; len: number } | null = null
/** Element, ze kterého se čte postup (lokálně první stopa, jinak online ukázka). */
let progressEl: HTMLAudioElement | null = null
/**
 * Ukázka slepená z `.sng` nemá použitelné `duration` ani nulový začátek —
 * první zvuková stránka nese pozici z prostředka skladby, takže přehrávač
 * hlásí `currentTime` klidně 90 s. Postup u ní proto měříme hodinami.
 */
let clockWindow: { startedAt: number; len: number } | null = null
/** Klíče ukázek, které jsou takhle slepené (platí i při přehrání z cache). */
const previewSpliced = new Set<string>()
/** Délka ukázky — stejná jako u online (iTunes/Deezer posílají 30s klip). */
const LOCAL_PREVIEW_SEC = 30

/**
 * Uloží blob ukázky do cache a při přeplnění uvolní nejstarší. NIKDY nezahodí
 * ten právě hrající — jinak by se odvolala jeho URL a zvuk by spadl na chybu.
 */
function cachePreviewBlob(
  key: string,
  url: string,
  label: string | null,
  playingKey: string | null
): void {
  if (previewBlobCache.size >= PREVIEW_BLOB_MAX) {
    for (const oldest of previewBlobCache.keys()) {
      if (oldest === playingKey || oldest === key) continue
      const oldUrl = previewBlobCache.get(oldest)
      if (oldUrl) URL.revokeObjectURL(oldUrl)
      previewBlobCache.delete(oldest)
      previewLabelCache.delete(oldest)
      previewSpliced.delete(oldest)
      break
    }
  }
  previewBlobCache.set(key, url)
  previewLabelCache.set(key, label)
}

/** Přístup k sdílenému audio elementu (pro progress ring v aktivním řádku). */
export function getPreviewAudioEl(): HTMLAudioElement | null {
  return progressEl
}

/**
 * Postup ukázky 0..1. U lokálních stop se počítá z 30s okna — `duration` je tam
 * délka celé písně, takže by kroužek sotva popolezl.
 */
export function getPreviewProgress(): number {
  // Slepená ukázka: `currentTime` ani `duration` se nedají použít (viz
  // `clockWindow`), takže se počítá uplynulý čas. Blob je v paměti, takže
  // se nedobufferovává a hodiny sedí s tím, co je slyšet.
  if (clockWindow) {
    return Math.max(0, Math.min(1, (Date.now() - clockWindow.startedAt) / (clockWindow.len * 1000)))
  }
  const el = progressEl
  if (!el) return 0
  if (localWindow) {
    return Math.max(0, Math.min(1, (el.currentTime - localWindow.start) / localWindow.len))
  }
  const d = el.duration || LOCAL_PREVIEW_SEC
  return d > 0 ? Math.min(1, el.currentTime / d) : 0
}

/**
 * Připraví stopu k synchronnímu startu: počká na metadata, přetočí na `start`
 * a počká, až je co přehrávat. Teprve když jsou takhle nachystané všechny,
 * spustí se naráz — jinak by každá naskočila jindy a mix by se rozešel.
 *
 * Timeout je pojistka proti zaseknutí (poškozený soubor, kodek navíc), ať
 * jedna vadná stopa nezablokuje celou ukázku.
 */
function seekReady(el: HTMLAudioElement, start: number): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    timer = window.setTimeout(finish, 6000)
    el.addEventListener('error', finish, { once: true })

    const afterSeek = (): void => {
      // HAVE_FUTURE_DATA = je co hrát; jinak počkej na canplay.
      if (el.readyState >= 3) finish()
      else el.addEventListener('canplay', finish, { once: true })
    }
    const onMeta = (): void => {
      if (start > 0 && el.duration && start < el.duration) {
        el.addEventListener('seeked', afterSeek, { once: true })
        el.currentTime = start
      } else {
        afterSeek()
      }
    }
    // readyState >= 1 (HAVE_METADATA) → délka je známá, dá se přetáčet.
    if (el.readyState >= 1) onMeta()
    else el.addEventListener('loadedmetadata', onMeta, { once: true })
  })
}

/** Zastaví a zahodí lokální stopy (uvolní i spojení na `chm-audio://`). */
function stopLocalAudio(): void {
  if (localTimer !== null) {
    clearTimeout(localTimer)
    localTimer = null
  }
  for (const el of localEls) {
    el.pause()
    el.removeAttribute('src')
    el.load() // ukončí probíhající Range požadavky
  }
  localEls = []
  localWindow = null
}

function stopPreviewAudio(): void {
  stopLocalAudio()
  clockWindow = null
  if (previewAudio) {
    previewAudio.pause()
    try {
      previewAudio.currentTime = 0
    } catch {
      /* některé stavy to nedovolí — nevadí */
    }
  }
  progressEl = null
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

  /**
   * Kdy jít přes LOKÁLNÍ KATALOG místo živých API. Jen tam, kde je API slabé —
   * běžné hledání/procházení zůstává živé (nejčerstvější data, relevance):
   *  - charter/album filtr: API ho neumí vůbec (dřív jen zužoval načtenou stránku)
   *  - tier rozsah / Encore multi-nástroj: dřív pomalý deep scan po stránkách
   *  - žánr/rok/dekáda/délka mimo čisté RhythmVerse: server je umí jen pro RV
   *    (Both se degradoval na RV-only a Encore je ignoroval)
   */
  /** Je katalog použitelný pro PRÁVĚ VYBRANOU databázi? Per-zdroj — Encore se
   *  staví první, takže jeho záložka naskočí dřív než RV/Both. */
  const catalogUsableForDb = (): boolean => {
    const s = get()
    const src = s.catalogStatus?.sources
    if (!src) return false
    if (s.database === 'enchor') return src.en.ready
    if (s.database === 'rhythmverse') return src.rv.ready
    return src.en.ready && src.rv.ready
  }

  const catalogEligible = (): boolean => {
    const s = get()
    if (!catalogUsableForDb()) return false
    if (s.charterFilter.trim() || s.albumFilter.trim()) return true
    if (s.reductions !== 'any') return true
    if (s.directOnly) return true
    if (s.hideOwned) return true
    if (needsDeepScan()) return true
    const f = s.filters
    const rvOnly = !!(f.genre?.length || f.year?.length || f.decade?.length || f.songLength?.length)
    if (rvOnly && s.database !== 'rhythmverse') return true
    // Celé PROCHÁZENÍ (prázdný dotaz) lokálně: stránkování, instrument filtr
    // i řazení jsou pak instantní (~10–100 ms místo ~1 s síťové stránky).
    // Textové hledání zůstává na živém API kvůli relevanci a čerstvosti.
    return !s.query.trim()
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
  /**
   * Kolik stránek stahovat naráz — POUZE pro RhythmVerse. Dřív se čekalo na
   * každou zvlášť, takže 40 stránek znamenalo 40 čekání na síť za sebou a linka
   * byla skoro celou dobu nečinná. Čtyři je kompromis — znatelně rychlejší, ale
   * pořád ohleduplné k API (při větším náporu začne RhythmVerse omezovat).
   * Chorus Encore souběh NESNESE (vrací 503) → tam se skenuje sériově, viz
   * `parallel` v deepScan.
   */
  const DEEP_PARALLEL = 4
  /** Sken tahá po 100 (ne po `records`) → 40 stránek = 4000 písní pokrytí při
   *  stejném počtu requestů. Zobrazení pak stránkuje lokálně po `records`. */
  const DEEP_FETCH = 100

  // ── Sdílené kroky „výběr cíle → zařazení do fronty" ────────────────────────
  // Tytéž tři kroky se opakovaly ve všech download tocích (jednotlivý / dávka /
  // lokální drop). Tady jsou jednou, ať se guardy a error handling nerozejdou.

  /** Načte cílové podsložky knihovny do stavu (pro modal výběru cíle). Volající
   *  už nastavil `foldersLoading: true`. Selhání není fatální — nabídne prázdný
   *  seznam (uživatel napíše vlastní / nechá kořen). */
  const loadFolders = async (): Promise<void> => {
    try {
      const folders = await window.api.listSongFolders()
      set({ folders, foldersLoading: false })
      // Počty písní dotáhni AŽ POTOM a na pozadí — je to rekurzivní čtení disku,
      // takže by jinak zdrželo zobrazení seznamu. Odznaky doskočí, jak dorazí.
      void window.api
        .libFolderCounts('')
        .then((counts) => set({ folderCounts: counts }))
        .catch(() => {
          /* nevadí — nabídka bude prostě bez počtů */
        })
    } catch {
      set({ folders: [], foldersLoading: false })
    }
  }

  /** Zařadí JEDNU píseň a zapamatuje jobId (guard proti dvojkliku + stav řádku).
   *  Chybu vloží do `error`. */
  const enqueueOne = async (song: SongResult, subfolder?: string): Promise<void> => {
    try {
      const jobId = await window.api.enqueueDownload(song, subfolder)
      set((s) => ({ enqueuedKeys: { ...s.enqueuedKeys, [song.key]: jobId } }))
    } catch (e) {
      set({ error: userMsg(e) })
    }
  }

  /** Zařadí DÁVKU písní; jednotlivé selhání dávku nezastaví (jen tu píseň
   *  vynechá). Nasbíraná jobId se slijí do `enqueuedKeys` naráz. */
  const enqueueMany = async (songs: SongResult[], subfolder?: string): Promise<void> => {
    const newEntries: Record<string, string> = {}
    for (const song of songs) {
      try {
        newEntries[song.key] = await window.api.enqueueDownload(song, subfolder)
      } catch {
        /* jednotlivé selhání nezastaví dávku */
      }
    }
    set((s) => ({ enqueuedKeys: { ...s.enqueuedKeys, ...newEntries } }))
  }

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
      const q = query.trim()
      const filters = buildServerFilters()
      const { sort, sortDir } = get()
      // Souběh podle databáze. Chorus Encore (a tím i „Both", které ho dotazuje)
      // vrací 503, jakmile na něj tečou souběžné požadavky — jeho Cloudflare
      // frontend concurrent load shazuje. RhythmVerse souběh v pohodě snese.
      // Proto Encore/Both skenujeme SÉRIOVĚ (spolehlivé), RV paralelně (rychlé).
      const parallel = database === 'rhythmverse' ? DEEP_PARALLEL : 1
      // Klíč cache = PŘESNĚ to, co jde na server. Obtížnostní tier tu schválně
      // není (filtruje se lokálně), takže jeho změna sáhne do cache místo sítě.
      const keyFor = (p: number): string =>
        JSON.stringify([q, p, database, system, filters ?? null, sort, sortDir])

      const fetchPage = async (p: number): Promise<DeepPage> => {
        const key = keyFor(p)
        const hit = deepCacheGet(key)
        if (hit) return hit
        const res = await window.api.search(q, p, DEEP_FETCH, system, database, filters, sort, sortDir)
        const page: DeepPage = { songs: res.songs, total: res.totalFiltered || res.songs.length }
        deepCacheSet(key, page)
        return page
      }

      // Stránky držíme podle ČÍSLA: paralelně dorazí zpřeházené, ale pořadí
      // výsledků musí zůstat takové, v jakém je poslal server (jinak by se
      // rozpadlo řazení).
      const pages: (SongResult[] | undefined)[] = []
      let rawTotalPages = 1
      let lastPage = 1
      let total = 0

      const publish = (): void => {
        const seen = new Set<string>()
        const merged: SongResult[] = []
        let scanned = 0
        for (let p = 1; p <= lastPage; p++) {
          const chunk = pages[p]
          if (!chunk) continue
          scanned++
          // Dedup napříč stránkami (v „Both" může tatáž píseň přijít z RV i
          // Encore na různých stránkách; IPC dedupuje jen v rámci jedné stránky).
          for (const s of chunk) {
            if (seen.has(s.key)) continue
            seen.add(s.key)
            merged.push(s)
          }
        }
        set({
          deepSongs: merged,
          deepScannedPages: scanned,
          deepTotalPages: lastPage,
          totalFiltered: total,
          loading: false // od první stránky ukazujeme přibývající shody živě
        })
      }

      // První stránka musí doběhnout sama — teprve z ní víme, kolik jich je.
      const first = await fetchPage(1)
      if (myReq !== searchSeq) return // mezitím odstartovalo novější hledání
      total = first.total
      rawTotalPages = Math.max(1, Math.ceil(total / DEEP_FETCH))
      lastPage = Math.min(rawTotalPages, DEEP_MAX_PAGES)
      pages[1] = first.songs
      publish()

      // Zbytek po dávkách. Tady je ta úspora: místo 40 čekání na síť za sebou
      // jich je 10 po čtyřech.
      for (let start = 2; start <= lastPage; start += parallel) {
        const batch: number[] = []
        for (let p = start; p < start + parallel && p <= lastPage; p++) batch.push(p)
        const res = await Promise.all(batch.map(fetchPage))
        if (myReq !== searchSeq) return
        batch.forEach((p, i) => {
          pages[p] = res[i].songs
        })
        publish()
        // Prázdná stránka = katalog došel dřív, než tvrdil `total`.
        if (res.some((r) => r.songs.length === 0)) break
      }

      if (myReq !== searchSeq) return
      set({ deepLoading: false, deepCapHit: rawTotalPages > DEEP_MAX_PAGES })
    } catch (e) {
      if (myReq !== searchSeq) return
      set({
        deepLoading: false,
        loading: false,
        error: userMsg(e)
      })
    }
  }

  /**
   * Hledání přes lokální katalog (viz catalogEligible). Jedna rychlá SQL
   * stránka místo deep scanu / degradovaného Both — s plným pokrytím filtrů
   * u obou databází. Výsledek se tváří jako běžná serverová stránka.
   */
  const catalogSearch = async (page: number): Promise<void> => {
    get().stopPreview()
    const myReq = ++searchSeq
    set({ loading: true, error: null, ...(get().surprise ? { results: [], surprise: false } : {}) })
    try {
      const s = get()
      const f = s.filters
      // Katalog ukládá zobrazované řetězce žánrů — RV id přelož přes číselník
      // (bez načtených voleb nech id; Encore žánry jsou stejně volný text).
      const opts = s.filterOptions
      const genreLabels = f.genre?.map(
        (id) => opts?.genre.find((o) => o.id === id)?.label ?? id
      )
      const res = await window.api.catalogQuery({
        text: s.query.trim() || undefined,
        database: s.database,
        system: s.system,
        genreLabels,
        year: f.year,
        decade: f.decade,
        songLength: f.songLength,
        charter: s.charterFilter.trim() || undefined,
        album: s.albumFilter.trim() || undefined,
        reductions: s.reductions === 'any' ? undefined : s.reductions,
        directOnly: s.directOnly || undefined,
        excludeOwned: s.hideOwned || undefined,
        instruments: s.instrumentFilters,
        diffMin: s.diffMin,
        diffMax: s.diffMax,
        sort: s.sort,
        sortDir: s.sortDir,
        page,
        records: s.records
      })
      if (myReq !== searchSeq) return
      set({
        results: res.songs,
        totalFiltered: res.totalFiltered,
        resultCount: res.resultCount ?? res.totalFiltered,
        page,
        loading: false,
        selectedIndex: -1,
        selectedKeys: [],
        deep: false,
        deepSongs: [],
        deepLoading: false,
        deepCapHit: false,
        surprise: false
      })
    } catch (e) {
      if (myReq !== searchSeq) return
      set({ loading: false, error: userMsg(e) })
    }
  }

  /**
   * Přehraje zvuk písně ležící v knihovně (u stopově dělených chartů všechny
   * stopy naráz, ať je mix úplný). Vrací `false`, když ve složce žádné audio
   * není — volající pak může zkusit jiný zdroj.
   *
   * Stav (`previewKey`, `loading`) si nastavuje VOLAJÍCÍ. Právě proto to je
   * samostatná funkce: používá ji jak tlačítko v Library manageru, tak ukázka
   * u výsledků hledání, která tudy zkusí sáhnout dřív, než půjde na internet.
   */
  const playLocalTracks = async (key: string, rel: string): Promise<boolean> => {
    const audio = await window.api.songAudio(rel)
    // Přepnuto jinam → tvař se jako hotovo, ať volající nezkouší další zdroj.
    if (get().previewKey !== key) return true
    if (audio.tracks.length === 0) return false

    const els = audio.tracks.map((t) => {
      const el = new Audio()
      el.preload = 'auto'
      // Každou stopu na stejnou hlasitost: stopy dohromady tvoří původní mix,
      // takže rovnoměrné ztlumení zachová poměry a jen ztiší celek.
      el.volume = PREVIEW_VOLUME
      el.src = t.url
      return el
    })
    localEls = els

    const start = (audio.previewStartMs ?? 0) / 1000
    // Počkej, až je každá stopa připravená a najetá na start. Bez toho by se
    // spustily nestejně a mix by se rozjel.
    await Promise.all(els.map((el) => seekReady(el, start)))
    if (get().previewKey !== key) {
      stopLocalAudio()
      return true
    }

    progressEl = els[0]
    localWindow = { start: els[0].currentTime, len: LOCAL_PREVIEW_SEC }
    // Spustit v jednom kroku, ať stopy nezačnou posunuté.
    await Promise.all(els.map((el) => el.play().catch(() => undefined)))
    if (get().previewKey !== key) {
      stopLocalAudio()
      return true
    }
    set({ previewState: 'playing' })

    // Lokální soubor je celá píseň → ukázku sami utneme po 30 s.
    localTimer = window.setTimeout(() => {
      if (get().previewKey === key) get().stopPreview()
    }, LOCAL_PREVIEW_SEC * 1000)
    return true
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
  // Start rovnou ve `loading` stavu → první snímek je skeleton, ne záblesk
  // prázdného „Search for a song…" (mount effect stejně hned spustí browse
  // katalogu, který `loading` po dorazení dat vypne).
  loading: true,
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
  showAbout: false,
  instrumentFilters: [],
  diffMin: 0,
  diffMax: 6,
  charterFilter: '',
  albumFilter: '',
  reductions: 'any',
  directOnly: false,
  ownedKeys: new Set<string>(),
  hideOwned: false,
  // Default = 'newest': první stránka se přirozeně mění, jak přibývají charty.
  // Tlačítko pořád ukazuje „Sort by" (viz `sortTouched`), takže se uživatel
  // nespletě, že by šlo o aktivní volbu z jeho strany.
  sort: 'newest',
  sortDir: SORT_DEFAULT_DIR.newest,
  sortTouched: false,
  surprise: false,
  marketplacePrompt: null,
  pendingSong: null,
  folders: [],
  folderCounts: {},
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
  catalogStatus: null,
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

  toggleLocalPreview: async (key, rel) => {
    const { previewKey, previewState } = get()

    // Klik na tutéž (hrající/načítající) ukázku = zastavit.
    if (previewKey === key && (previewState === 'playing' || previewState === 'loading')) {
      get().stopPreview()
      return
    }

    stopPreviewAudio()
    set({ previewKey: key, previewState: 'loading', previewLabel: null })

    try {
      const played = await playLocalTracks(key, rel)
      if (!played && get().previewKey === key) set({ previewState: 'unavailable' })
    } catch {
      if (get().previewKey === key) set({ previewState: 'error' })
    }
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

    // Máme píseň v knihovně? Pak hraj rovnou z disku. Je to SKUTEČNÝ zvuk
    // chartu, ne spárovaná ukázka, a funguje i tam, kde iTunes ani Deezer nic
    // nenajdou (fanouškovské kousky, herní hudba, remixy). Pozor: knihovna se
    // páruje na interpret+název, takže u jiné verze téže písně zazní ta tvoje.
    if (get().ownedKeys.has(songKey(song.artist, song.title))) {
      try {
        const rels = await window.api.ownedFolders(song.artist, song.title)
        if (get().previewKey !== key) return
        if (rels.length > 0) {
          set({ previewLabel: 'your copy' })
          if (await playLocalTracks(key, rels[0])) return
          // Ve složce nebylo audio → spadni na online ukázku.
          set({ previewLabel: null })
        }
      } catch {
        /* nevadí — zkusíme online ukázku */
      }
      if (get().previewKey !== key) return
    }

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
      progressEl = a // kroužek čte postup odsud
      set({ previewState: 'playing', previewLabel: label })
      // Slepená ukázka nemá konec ani spolehlivou délku — utneme ji sami po
      // 30 s, ať se chová stejně jako klip z iTunes, a postup měříme hodinami.
      if (previewSpliced.has(key)) {
        clockWindow = { startedAt: Date.now(), len: LOCAL_PREVIEW_SEC }
        localTimer = window.setTimeout(() => {
          if (get().previewKey === key) get().stopPreview()
        }, LOCAL_PREVIEW_SEC * 1000)
      }
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

    // Chart z Encore? Ten hostuje `.sng` přímo a server umí Range požadavky,
    // takže jde vytáhnout kousek SKUTEČNÉHO zvuku (~0,5 MB z desítek MB) místo
    // spárované nahrávky. Zní pak přesně to, co se stáhne — včetně coverů
    // a fanouškovských verzí, které hudební služby vůbec nemají.
    if (song.downloadUrl && /\.sng($|\?)/i.test(song.downloadUrl)) {
      try {
        const real = await window.api.sngPreview(song.downloadUrl)
        if (get().previewKey !== key) return
        if (real) {
          const url = URL.createObjectURL(new Blob([real.data], { type: real.mime }))
          // Označ jako slepenou, ať `play()` nasadí vlastní 30s okno — platí
          // to i při pozdějším přehrání z cache.
          previewSpliced.add(key)
          cachePreviewBlob(key, url, 'chart audio', get().previewKey)
          play(url, 'chart audio')
          return
        }
      } catch {
        /* nevadí — spadneme na spárovanou ukázku */
      }
      if (get().previewKey !== key) return
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
      const label =
        res.matchedArtist && res.matchedTitle
          ? `${res.matchedArtist} - ${res.matchedTitle}`
          : null
      cachePreviewBlob(key, url, label, get().previewKey)
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
    //
    // Vyčistíme i `results`/`deep`/`deepSongs`/totals: bez toho staré výsledky
    // z předchozí databáze visí pod novým labelem, než doběhne nový fetch. Prázdný
    // stav = UI hned ukáže skeleton (doSearch nastaví `loading: true`).
    const revert = get().sort === 'downloads' && d === 'enchor'
    const patch: Partial<AppState> = {
      database: d,
      results: [],
      deep: false,
      deepSongs: [],
      totalFiltered: 0,
      resultCount: 0
    }
    if (d === 'enchor') {
      patch.filters = {}
      if (revert) {
        patch.sort = 'newest'
        patch.sortDir = SORT_DEFAULT_DIR.newest
        patch.sortTouched = false
      }
    }
    set(patch as Partial<AppState>)
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
  watchCatalog: () => {
    void window.api
      .catalogStatus()
      .then((s) => set({ catalogStatus: s }))
      .catch(() => {
        /* main bez katalogu (např. selhal init) → zůstane null a jede se API */
      })
    window.api.onCatalogStatus((s) => {
      const prev = get().catalogStatus
      set({ catalogStatus: s })
      // Katalog se právě stal použitelným (init/build dokončen) → znovu pošli
      // owned klíče. Pojistka proti závodu: loadOwnedKeys při startu mohl
      // catalogSetOwned zavolat dřív, než byla DB inicializovaná (no-op).
      if (s.usable && !(prev?.usable ?? false)) {
        void window.api.catalogSetOwned([...get().ownedKeys]).catch(() => {})
      }
      // Doběhl sync (změna lastSync) → katalogem zobrazené výsledky můžou být
      // zastaralé (typicky „nejnovější" z přibaleného seedu hned po instalaci).
      // Tiše přenačti AKTUÁLNÍ stránku — ale jen když do ničeho nešaháme:
      // nic vybraného, nehraje ukázka, neběží jiné hledání, žádné losování.
      const st = get()
      if (
        prev !== null &&
        s.lastSync !== prev.lastSync &&
        catalogEligible() &&
        !st.loading &&
        !st.surprise &&
        st.selectedKeys.length === 0 &&
        st.previewKey === null
      ) {
        void st.doSearch(st.page)
      }
    })
  },
  // S katalogem je charter/album skutečný filtr přes celou DB → přehledat
  // (debounce, ať se nehledá na každý stisk). Bez katalogu zůstává původní
  // chování: jen klientské zúžení načtené stránky v App.tsx.
  setCharterFilter: (v) => {
    set({ charterFilter: v, selectedIndex: -1 })
    if (catalogUsableForDb()) runRefineSearch(get, v)
  },
  setAlbumFilter: (v) => {
    set({ albumFilter: v, selectedIndex: -1 })
    if (catalogUsableForDb()) runRefineSearch(get, v)
  },
  setReductions: (v) => {
    set({ reductions: v, selectedIndex: -1 })
    void get().doSearch(1)
  },
  setDirectOnly: (v) => {
    set({ directOnly: v, selectedIndex: -1 })
    void get().doSearch(1)
  },
  setHideOwned: (v) => {
    set({ hideOwned: v, selectedIndex: -1 })
    // S katalogem filtruje přes celou DB → přehledej. Bez katalogu doSearch
    // stejně skončí na živém API a App.tsx to dorovná client refinem.
    void get().doSearch(1)
  },
  loadOwnedKeys: async () => {
    try {
      const keys = await window.api.ownedSongKeys()
      set({ ownedKeys: new Set(keys) })
      // Předej sadu i katalogu, ať „Hide owned" filtruje přes CELÝ katalog
      // (ne jen načtenou stránku). Selhání není fatální — spadne na client refine.
      void window.api.catalogSetOwned(keys).catch(() => {})
    } catch {
      /* nevadí — nápověda „In library" prostě nebude */
    }
  },
  // Řazení jde serverově (aby A-Z sedělo napříč VŠEMI stránkami, ne jen v rámci
  // jedné) → změna sortu přenačte od stránky 1. V deep režimu se tím přeskenuje
  // se správným server sortem, v „Both" navíc klient srovná sloučenou stránku.
  setSort: (s) => {
    // `sortTouched: true` = uživatel aktivně sáhnul do menu → tlačítko od teď
    // ukazuje konkrétní volbu, ne „Sort by". Změna klíče resetuje směr na jeho
    // výchozí (Title→A-Z, Downloads→nejvíc první…); šipkou ho pak lze přepnout.
    set({ sort: s, sortDir: SORT_DEFAULT_DIR[s], sortTouched: true, selectedIndex: -1, page: 1 })
    void get().doSearch(1)
  },
  setSortDir: (d) => {
    set({ sortDir: d, sortTouched: true, selectedIndex: -1, page: 1 })
    void get().doSearch(1)
  },
  surpriseMe: async () => {
    get().stopPreview()
    const { query, system, database, records, sort, sortDir } = get()
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
        const probe = await window.api.search(query.trim(), 1, 1, system, database, filters, sort, sortDir)
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
        pick = Math.min(ENCORE_PER_PAGE_MAX, Math.max(records, 100))
        maxPage = Math.max(1, Math.ceil(total / pick))
      } else if (database === 'both') {
        pick = Math.min(ENCORE_PER_PAGE_MAX, Math.max(records, Math.ceil(total / RV_SURPRISE_MAX_PAGE)))
        maxPage = Math.max(1, Math.min(RV_SURPRISE_MAX_PAGE, Math.ceil(total / pick)))
      } else {
        pick = Math.min(RV_SURPRISE_PICK, Math.max(records, Math.ceil(total / RV_SURPRISE_MAX_PAGE)))
        maxPage = Math.max(1, Math.min(RV_SURPRISE_MAX_PAGE, Math.ceil(total / pick)))
      }
      const randPage = 1 + Math.floor(Math.random() * maxPage)
      const res = await window.api.search(query.trim(), randPage, pick, system, database, filters, sort, sortDir)
      if (myReq !== searchSeq) return
      const pool = res.songs
      if (!pool.length) {
        set({ loading: false, surprise: false })
        return
      }
      // Vylosuj N unikátních písní. Dřív to bylo jen 1 → uživatel musel klikat
      // znovu a znovu. Když má pool méně než N (drobný katalog / úzký filtr),
      // vezmi vše, co je — nedopisuj to opakovanými picky.
      const WANT = 5
      // Co už v knihovně je, nenabízet — losování má sloužit k objevování, ne
      // ukazovat, co si uživatel dávno stáhl. Kdyby po odfiltrování nezbylo nic
      // (úzký filtr nebo malý katalog, kde má všechno), radši nabídni původní
      // výběr než prázdnou obrazovku.
      const { ownedKeys } = get()
      const fresh = pool.filter((s) => !ownedKeys.has(songKey(s.artist, s.title)))
      const candidates = fresh.length > 0 ? fresh : pool
      const shuffled = [...candidates].sort(() => Math.random() - 0.5)
      const picks = shuffled.slice(0, Math.min(WANT, shuffled.length))
      set({
        results: picks,
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
      set({ loading: false, surprise: false, error: userMsg(e) })
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
      reductions: 'any',
      directOnly: false,
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
  setShowAbout: (v) => set({ showAbout: v }),
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
    // Lokální katalog přednostně — pokrývá vše, co server neumí (charter/album,
    // tier, Encore žánr…), jednou rychlou SQL stránkou místo deep scanu.
    if (catalogEligible()) {
      return catalogSearch(page)
    }
    // Jen to, co server neumí (tier / Encore multi-nástroj) → deep scan.
    // Jeden nástroj i víc nástrojů na RhythmVerse zvládne server (AND) → jde
    // normální serverové stránkování s plným pokrytím a bez záplavy requestů.
    // (Fallback pro dobu, než je katalog poprvé synchronizovaný.)
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
      const sortDir = get().sortDir
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
          rvPageItems(q, system, sort, sortDir, filters, page, records, myReq),
          window.api.search(q, page, records, system, 'enchor', filters, sort, sortDir)
        ])
        if (myReq !== searchSeq) return
        if (rvR.status === 'rejected' && enR.status === 'rejected') {
          throw asError(rvR.reason)
        }
        const rv = rvR.status === 'fulfilled' ? rvR.value : null
        const enSongs = enR.status === 'fulfilled' ? enR.value.songs : []
        const enTot = enR.status === 'fulfilled' ? enR.value.totalFiltered : 0
        // Stejné slučování jako mělké „Both" v ipc.ts (sdílený `mergeBoth`).
        songs = mergeBoth(rv ? rv.songs : [], enSongs, sort)
        total = Math.max(rv ? rv.total : 0, enTot)
        rcount = (rv ? rv.total : 0) + enTot
      } else if (database === 'rhythmverse' && page > RV_PAGE_CAP) {
        const rv = await rvPageItems(q, system, sort, sortDir, filters, page, records, myReq)
        if (rv === null) return
        songs = rv.songs
        total = rv.total
        rcount = total
      } else {
        const res = await window.api.search(q, page, records, system, database, filters, sort, sortDir)
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
      set({ loading: false, error: userMsg(e) })
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
      await enqueueOne(song)
      return
    }
    set({ pendingSong: song, foldersLoading: true })
    await loadFolders()
  },

  confirmDownload: async (subfolder) => {
    const song = get().pendingSong
    if (!song) return
    // Pending nulujeme HNED — držení Enteru / dvojklik by jinak zařadily
    // tutéž píseň vícekrát (guard proti opakovanému confirmu během await).
    set({ pendingSong: null, lastSubfolder: subfolder })
    await enqueueOne(song, subfolder || undefined)
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
      await enqueueMany(downloadable)
      return
    }
    set({ pendingBatch: downloadable, foldersLoading: true })
    await loadFolders()
  },
  confirmBatchDownload: async (subfolder) => {
    const batch = get().pendingBatch
    if (!batch) return
    // Guard proti dvojímu confirmu (držení Enteru) — jinak by se celá dávka
    // zařadila dvakrát.
    set({ pendingBatch: null, selectedKeys: [], lastSubfolder: subfolder })
    await enqueueMany(batch, subfolder || undefined)
  },
  cancelBatchDownload: () => set({ pendingBatch: null }),

  // ---- Hromadný lokální drop ----
  openLocalBatch: async (paths) => {
    if (paths.length === 0) return
    set({ pendingLocalBatch: paths, foldersLoading: true })
    await loadFolders()
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
      set({ error: userMsg(e) })
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
    await loadFolders()
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
      set({ error: userMsg(e) })
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
    // Zrušená úloha se sama uklidí po 2 s — uživatel ji zrušil, nemá důvod ji
    // držet v historii (na rozdíl od 'error', kde si chce přečíst příčinu). Když
    // to byla poslední položka, lišta fronty se pak sama zavře.
    if (job.stage === 'canceled') {
      setTimeout(() => {
        const cur = useStore.getState().jobs[job.id]
        if (!cur || cur.stage !== 'canceled') return
        useStore.setState((s) => {
          const { [job.id]: _gone, ...rest } = s.jobs
          return { jobs: rest }
        })
      }, 2000)
    }
  },

  clearFinishedJobs: async () => {
    await window.api.clearFinishedJobs()
    set((s) => {
      const jobs: typeof s.jobs = {}
      const removed = new Set<string>()
      for (const [id, j] of Object.entries(s.jobs)) {
        if (j.stage === 'done' || j.stage === 'error' || j.stage === 'canceled') removed.add(id)
        else jobs[id] = j
      }
      const enqueuedKeys: typeof s.enqueuedKeys = {}
      for (const [k, id] of Object.entries(s.enqueuedKeys)) {
        if (!removed.has(id)) enqueuedKeys[k] = id
      }
      return { jobs, enqueuedKeys }
    })
  },

  cancelJob: async (id) => {
    // Uvolni klíč z `enqueuedKeys` hned, ať jde píseň případně stáhnout znovu
    // (finální stav 'canceled' dorazí přes jobs:update event z main procesu).
    set((s) => {
      const enqueuedKeys: typeof s.enqueuedKeys = {}
      for (const [k, jid] of Object.entries(s.enqueuedKeys)) if (jid !== id) enqueuedKeys[k] = jid
      return { enqueuedKeys }
    })
    await window.api.cancelJob(id)
  },

  cancelAllJobs: async () => {
    await window.api.cancelAllJobs()
    // enqueuedKeys pro aktivní úlohy uvolníme podle toho, které zůstanou
    // neterminální — jednoduše všechny, co nejsou 'done' (zrušené a rozdělané
    // ať jdou stáhnout znovu). Finální stavy dorazí přes jobs:update.
    set((s) => {
      const activeIds = new Set(
        Object.entries(s.jobs)
          .filter(([, j]) => j.stage !== 'done')
          .map(([jid]) => jid)
      )
      const enqueuedKeys: typeof s.enqueuedKeys = {}
      for (const [k, jid] of Object.entries(s.enqueuedKeys)) {
        if (!activeIds.has(jid)) enqueuedKeys[k] = jid
      }
      return { enqueuedKeys }
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
