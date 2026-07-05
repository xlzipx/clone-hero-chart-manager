// Sdílené typy mezi main, preload a renderer procesem.

/** Obtížnosti jednotlivých nástrojů (0–6). Chybějící part = undefined. */
export interface InstrumentDifficulties {
  guitar?: number
  bass?: number
  drums?: number
  vocals?: number
  keys?: number
  proGuitar?: number
  proBass?: number
  proKeys?: number
  guitarghl?: number
  bassghl?: number
  band?: number
}

/** Normalizovaný výsledek vyhledávání z RhythmVerse. */
export interface SongResult {
  /** Stabilní klíč pro UI (record_id nebo file_id). */
  key: string
  fileId: number | null
  songId: number | null
  title: string
  artist: string
  album: string
  year: number | null
  genre: string
  /** Délka tracku v sekundách. */
  lengthSeconds: number | null
  /** Absolutní URL na obal alba, nebo null. */
  albumArtUrl: string | null
  difficulties: InstrumentDifficulties
  /**
   * Je chart jen na Expert (bez nižších obtížností)?
   * - true  = pouze Expert (žádné E/M/H reductions)
   * - false = má E/M/H/X
   * - null  = neznámé (zdroj to nehlásí, např. Chorus Encore)
   */
  expertOnly: boolean | null
  charter: string | null
  /** Hostitel souboru (např. Google Drive, Mediafire). */
  source: string | null
  /** Primární formát staženého souboru (např. rb3xbox, clonehero). */
  gameFormat: string | null
  /** Všechny formáty dostupné pro skladbu. */
  gameFormats: string[]
  /** True pokud je potřeba konverze (Rock Band CON apod.). */
  needsConversion: boolean
  /** True = oficiální DLC dostupné jen v obchodě (nelze stáhnout, jen otevřít). */
  official: boolean
  downloadUrl: string | null
  downloadPageUrl: string | null
  externalUrl: string | null
  sizeBytes: number | null
}

export interface SearchResponse {
  songs: SongResult[]
  totalFiltered: number
  page: number
  records: number
}

export type JobStage =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'extracting'
  | 'converting'
  | 'installing'
  | 'done'
  | 'error'

export interface DownloadJob {
  id: string
  song: SongResult
  /** Cílová podsložka uvnitř Songs (prázdné = kořen Songs). */
  targetSubfolder?: string
  stage: JobStage
  /** 0..1, nebo -1 pro neurčitý průběh. */
  progress: number
  message?: string
  error?: string
  installPath?: string
}

export interface HotkeyConfig {
  toggleOverlay: string
}

export type ReminderPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface AppConfig {
  songsDir: string
  c3BinDir: string
  /** Cesta k onyx.exe (CLI konvertor CON→CH). Prázdné = nenastaveno. */
  onyxPath: string
  /** Manuální cesta ke Clone Hero.exe. Prázdné = auto-detekce z `songsDir`. */
  chExePath: string
  /** Manuální cesta k YARG.exe. Prázdné = auto-detekce v běžných instalech. */
  yargExePath: string
  recordsPerPage: number
  hotkeys: HotkeyConfig
  /** Zobrazit malý reminder pill přes hru, když CH běží. */
  showReminder: boolean
  /** Roh obrazovky, kde se reminder zobrazí. */
  reminderPosition: ReminderPosition
}

export type RhythmVerseSystem = 'ch' | 'ps' | 'rb3' | 'all'

/** Zdrojová databáze chartů. */
export type Database = 'rhythmverse' | 'enchor' | 'both'

/** Položka ve správci knihovny (složka/soubor). */
export interface LibEntry {
  name: string
  type: 'dir' | 'file'
  isSong: boolean
}

export interface LibListing {
  path: string
  entries: LibEntry[]
}

export interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
  /** URL stránky s vydáním na GitHubu. */
  url: string
}

export interface UpdateAvailable {
  version: string
  /** true = instalační verze umí self-update; false = portable → jen ruční odkaz. */
  canAutoUpdate: boolean
  /** URL na release (jen u ručního fallbacku). */
  url?: string
}

export interface ReleaseNotes {
  version: string
  name: string
  /** Markdown tělo poznámek k vydání z GitHubu. */
  body: string
  url: string
}

/** API vystavené do renderer procesu přes contextBridge (window.api). */
export interface RendererApi {
  search(
    text: string,
    page: number,
    records: number,
    system?: RhythmVerseSystem,
    database?: Database
  ): Promise<SearchResponse>
  enqueueDownload(song: SongResult, targetSubfolder?: string): Promise<string>
  /** Spustí pipeline pro lokální soubor (drag-and-drop z disku). */
  enqueueLocalFile(
    localPath: string,
    song: SongResult,
    targetSubfolder?: string
  ): Promise<string>
  /** Hromadně zařadí dropnuté soubory/složky (metadata z názvů). */
  enqueueLocalBatch(paths: string[], targetSubfolder?: string): Promise<string[]>
  /** Vrátí názvy přímých podsložek v knihovně Songs. */
  listSongFolders(): Promise<string[]>
  /** Normalizované klíče (artist|title) písní už v knihovně — pro „In library" nápovědu. */
  ownedSongKeys(): Promise<string[]>
  // Správce knihovny
  libList(rel: string): Promise<LibListing>
  libCreateFolder(rel: string, name: string): Promise<void>
  libRename(relItem: string, newName: string): Promise<void>
  libTrash(relItem: string): Promise<void>
  libMove(src: string, destDir: string): Promise<void>
  libCopy(src: string, destDir: string): Promise<void>
  libOpen(rel: string): void
  libReveal(relItem: string): void
  getJobs(): Promise<DownloadJob[]>
  clearFinishedJobs(): Promise<void>
  onJobUpdate(cb: (job: DownloadJob) => void): () => void
  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  /** True if the configured Songs folder exists. */
  songsDirExists(): Promise<boolean>
  chooseDirectory(): Promise<string | null>
  /** Otevře nativní file picker pro chart/archiv. */
  chooseSongFile(): Promise<{ path: string; name: string } | null>
  /** Bezpečně získá absolutní cestu z drag-and-drop File. */
  getDroppedFilePath(file: File): string | null
  /** Přečte artist+title z lokálního souboru (rychlé pro .sng). */
  peekFileMeta(path: string): Promise<{ artist: string; title: string } | null>
  /** Rozbalí shortlink (bit.ly aj.) na finální URL. */
  resolveUrl(url: string): Promise<string>
  /** Která rhythm hra běží (CH nebo YARG), nebo null. */
  runningGame(): Promise<'clone-hero' | 'yarg' | null>
  /** Přepne hru do popředí — pokud žádná neběží, spustí preferenci (default CH). */
  bringGameToFront(
    prefer?: 'clone-hero' | 'yarg'
  ): Promise<{ ok: true; game?: 'clone-hero' | 'yarg' } | { ok: false; error: string }>
  /** Status detekce Clone Hero.exe – `path: null` znamená, že nebyl nalezen. */
  chExeStatus(): Promise<{ path: string | null; autoDetected: boolean }>
  /** Status detekce YARG.exe. */
  yargExeStatus(): Promise<{ path: string | null; autoDetected: boolean }>
  /** Otevře file picker pro `.exe`. */
  chooseExeFile(): Promise<string | null>
  /** Odběr změn stavu hry (poll 3s) — vrací která hra běží, nebo null. */
  onGameStatus(cb: (game: 'clone-hero' | 'yarg' | null) => void): () => void
  hideOverlay(): void
  quitApp(): void
  /** Dočasně pozastaví globální zkratky (při zachytávání nové zkratky). */
  pauseHotkeys(): void
  resumeHotkeys(): void
  onHotkey(cb: (action: string) => void): () => void
  openExternal(url: string): void
  // ---- Auto-update ----
  /** Spustí stažení aktualizace (jen instalační verze). */
  downloadUpdate(): Promise<{ ok: true } | { ok: false; error: string }>
  /** Nainstaluje staženou aktualizaci a restartuje appku. */
  installUpdate(): Promise<void>
  /** Přišla nová verze (auto nebo ruční fallback). */
  onUpdateAvailable(cb: (info: UpdateAvailable) => void): () => void
  /** Průběh stahování aktualizace (procenta). */
  onUpdateProgress(cb: (p: { percent: number }) => void): () => void
  /** Aktualizace stažená a připravená k instalaci. */
  onUpdateDownloaded(cb: (info: { version: string }) => void): () => void
  /** Aktuální verze aplikace. */
  appVersion(): Promise<string>
  /** Poznámky k vydání dané (nebo aktuální) verze z GitHubu. */
  getReleaseNotes(version?: string): Promise<ReleaseNotes | null>
}
