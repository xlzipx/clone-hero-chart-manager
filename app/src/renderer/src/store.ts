import { create } from 'zustand'
import type {
  AppConfig,
  Database,
  DownloadJob,
  RhythmVerseSystem,
  SongResult
} from '../../shared/types'
import { isAutoDownloadable } from './utils'

export type SortKey = 'relevance' | 'title' | 'artist' | 'length'

interface AppState {
  query: string
  database: Database
  system: RhythmVerseSystem
  page: number
  records: number
  results: SongResult[]
  totalFiltered: number
  loading: boolean
  error: string | null
  selectedIndex: number
  jobs: Record<string, DownloadJob>
  /** klíče písní, na které byl spuštěn download (pro UI stav tlačítka) */
  enqueuedKeys: Record<string, string> // songKey -> jobId
  config: AppConfig | null
  showSettings: boolean
  showLibrary: boolean
  showWhatsNew: boolean

  // Filtr podle nástroje (id nástroje, který musí být zahraný)
  instrumentFilters: string[]
  // Filtr obtížnosti (0–6) aplikovaný na vybrané nástroje
  diffMin: number
  diffMax: number
  // Zpřesňující filtry přes načtené výsledky (contains, case-insensitive)
  charterFilter: string
  albumFilter: string
  yearFilter: string
  // „Už mám v knihovně" — normalizované klíče písní + přepínač skrytí
  ownedKeys: Set<string>
  hideOwned: boolean
  // Řazení výsledků
  sort: SortKey

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

  setQuery: (q: string) => void
  setDatabase: (d: Database) => void
  setSystem: (s: RhythmVerseSystem) => void
  toggleInstrumentFilter: (id: string) => void
  setDiffRange: (min: number, max: number) => void
  setCharterFilter: (v: string) => void
  setAlbumFilter: (v: string) => void
  setYearFilter: (v: string) => void
  setHideOwned: (v: boolean) => void
  loadOwnedKeys: () => Promise<void>
  setSort: (s: SortKey) => void
  clearFilters: () => void
  setSelectedIndex: (i: number) => void
  setShowSettings: (v: boolean) => void
  setShowLibrary: (v: boolean) => void
  setShowWhatsNew: (v: boolean) => void
  doSearch: (page?: number) => Promise<void>
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

export const useStore = create<AppState>((set, get) => ({
  query: '',
  database: 'rhythmverse',
  system: 'ch',
  page: 1,
  records: 25,
  results: [],
  totalFiltered: 0,
  loading: false,
  error: null,
  selectedIndex: 0,
  jobs: {},
  enqueuedKeys: {},
  config: null,
  showSettings: false,
  showLibrary: false,
  showWhatsNew: false,
  instrumentFilters: [],
  diffMin: 0,
  diffMax: 6,
  charterFilter: '',
  albumFilter: '',
  yearFilter: '',
  ownedKeys: new Set<string>(),
  hideOwned: false,
  sort: 'relevance',
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

  setQuery: (q) => set({ query: q }),
  setDatabase: (d) => set({ database: d }),
  setSystem: (s) => set({ system: s }),
  toggleInstrumentFilter: (id) =>
    set((s) => ({
      instrumentFilters: s.instrumentFilters.includes(id)
        ? s.instrumentFilters.filter((x) => x !== id)
        : [...s.instrumentFilters, id],
      selectedIndex: 0
    })),
  setDiffRange: (min, max) =>
    set({
      diffMin: Math.max(0, Math.min(6, Math.min(min, max))),
      diffMax: Math.max(0, Math.min(6, Math.max(min, max))),
      selectedIndex: 0
    }),
  setCharterFilter: (v) => set({ charterFilter: v, selectedIndex: 0 }),
  setAlbumFilter: (v) => set({ albumFilter: v, selectedIndex: 0 }),
  setYearFilter: (v) => set({ yearFilter: v, selectedIndex: 0 }),
  setHideOwned: (v) => set({ hideOwned: v, selectedIndex: 0 }),
  loadOwnedKeys: async () => {
    try {
      const keys = await window.api.ownedSongKeys()
      set({ ownedKeys: new Set(keys) })
    } catch {
      /* nevadí — nápověda „In library" prostě nebude */
    }
  },
  setSort: (s) => set({ sort: s, selectedIndex: 0 }),
  clearFilters: () =>
    set({
      instrumentFilters: [],
      diffMin: 0,
      diffMax: 6,
      charterFilter: '',
      albumFilter: '',
      yearFilter: '',
      selectedIndex: 0
    }),
  setSelectedIndex: (i) => set({ selectedIndex: i }),
  setShowSettings: (v) => set({ showSettings: v }),
  setShowLibrary: (v) => set({ showLibrary: v }),
  setShowWhatsNew: (v) => set({ showWhatsNew: v }),

  doSearch: async (page = 1) => {
    const { query, system, database, records } = get()
    if (!query.trim()) {
      set({ results: [], totalFiltered: 0, error: null })
      return
    }
    set({ loading: true, error: null })
    try {
      const res = await window.api.search(query.trim(), page, records, system, database)
      set({
        results: res.songs,
        totalFiltered: res.totalFiltered,
        page: res.page,
        loading: false,
        selectedIndex: 0,
        selectedKeys: [] // nový výsledek → zruš předchozí výběr
      })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  openDownload: async (song) => {
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
    const jobId = await window.api.enqueueDownload(song, subfolder || undefined)
    set((s) => ({
      enqueuedKeys: { ...s.enqueuedKeys, [song.key]: jobId },
      pendingSong: null,
      lastSubfolder: subfolder
    }))
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
    const newEntries: Record<string, string> = {}
    for (const song of batch) {
      try {
        const jobId = await window.api.enqueueDownload(song, subfolder || undefined)
        newEntries[song.key] = jobId
      } catch {
        /* jednotlivé selhání nezastaví dávku */
      }
    }
    set((s) => ({
      enqueuedKeys: { ...s.enqueuedKeys, ...newEntries },
      pendingBatch: null,
      selectedKeys: [],
      lastSubfolder: subfolder
    }))
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
    const ids = await window.api.enqueueLocalBatch(paths, subfolder || undefined)
    set((s) => {
      const enqueuedKeys = { ...s.enqueuedKeys }
      ids.forEach((id, i) => {
        enqueuedKeys[`localbatch:${id}:${i}`] = id
      })
      return { enqueuedKeys, pendingLocalBatch: null, lastSubfolder: subfolder }
    })
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
      sizeBytes: null
    }
    const jobId = await window.api.enqueueLocalFile(
      pending.path,
      localSong,
      subfolder || undefined
    )
    set((s) => ({
      enqueuedKeys: { ...s.enqueuedKeys, [localSong.key]: jobId },
      pendingLocal: null,
      lastSubfolder: subfolder
    }))
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
    const config = await window.api.setConfig(patch)
    set({ config, records: config.recordsPerPage })
  }
}))
