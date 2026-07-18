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
  /** Počet stažení souboru (RhythmVerse `file.downloads`, živě aktuální). Chorus
   *  Encore počet stažení nevystavuje → null. */
  downloads: number | null
  /** Odkaz na Google Drive složku, kde chart leží (charterova sbírka). Jen Encore. */
  driveFolderUrl?: string | null
}

export interface SearchResponse {
  songs: SongResult[]
  /** Základ pro STRÁNKOVÁNÍ (počet stránek = ceil(totalFiltered/records)). U
   *  „Both" = MAX obou katalogů, protože obě DB se posouvají po stránkách v
   *  zákrytu (stránka P ukazuje RV[P]+EN[P]) → stránek je co má delší katalog. */
  totalFiltered: number
  /** Počet do LABELU „results found". Obvykle = totalFiltered; u „Both" = SOUČET
   *  obou katalogů (kolik chartů je dohromady k procházení), aby Both neukazoval
   *  stejné číslo jako samotný Encore. */
  resultCount?: number
  page: number
  records: number
}

/** Jedna skladba z importovaného playlistu (Spotify apod.) — jen metadata pro
 *  hledání chartu, ne odkaz ke stažení. */
export interface PlaylistTrack {
  title: string
  artist: string
  /** Délka v ms (jen orientační, ze Spotify embed), nebo null. */
  durationMs: number | null
}

/** Výsledek načtení playlistu z odkazu. `truncated` = zdroj pravděpodobně ořízl
 *  delší playlist (embed strop ~100 stop). */
export type PlaylistResolveResult =
  | { ok: true; source: 'spotify'; name: string; tracks: PlaylistTrack[]; truncated: boolean }
  | { ok: false; error: PlaylistResolveError }

/** Důvody, proč se playlist nepodařilo načíst (renderer je přeloží na hlášku). */
export type PlaylistResolveError =
  | 'not-a-playlist'
  | 'not-found'
  | 'empty'
  | 'network'
  | 'parse'
  | 'unknown'

/**
 * Serverové filtry pro „advanced search / browse". Hodnoty jsou normalizované
 * (nezávislé na providerovi); klient je namapuje na konkrétní API:
 *  - RhythmVerse: `genre[]`, `instrument[]`, `difficulties[]` (x/h/m/e),
 *    `decade[]`, `year[]`, `song_length[]` na endpoint `songfiles/list`
 *    (browse bez textu) nebo `search/live` (s textem).
 *  - Chorus Encore: server umí jen `instrument` + `difficulty`; ostatní ignoruje.
 */
export interface SearchFilters {
  /** ID žánru (RhythmVerse číselník: 'rock', 'poprock', …). */
  genre?: string[]
  /** 'guitar' | 'bass' | 'drums' | 'vocals' | 'keys' */
  instrument?: string[]
  /** Zahrané úrovně: 'expert' | 'hard' | 'medium' | 'easy'. */
  difficulty?: string[]
  /** Dekáda (RhythmVerse: '80' = 80. léta). */
  decade?: string[]
  /** Konkrétní rok vydání. */
  year?: string[]
  /** Rozsah délky (RhythmVerse: 'short_range' … 'epic_range'). */
  songLength?: string[]
}

/**
 * Řazení výsledků (normalizované, nezávislé na providerovi). Klient mapuje na
 * konkrétní API:
 *  - RhythmVerse: `sort[0][sort_by]` (title/artist/length/downloads/update_date)
 *    + `sort[0][sort_order]` (ASC/DESC).
 *  - Chorus Encore: `sort: { type, direction }` (name/artist/length/modifiedTime).
 * 'relevance' = neposílá se nic (server default / textová relevance). 'downloads'
 * umí jen RhythmVerse — Encore počet stažení nemá, takže tam padne na default.
 */
export type SortKey = 'relevance' | 'title' | 'artist' | 'downloads' | 'newest' | 'length'
export type SortDir = 'asc' | 'desc'

/** Výchozí směr každého řazení (když si uživatel směr sám nepřepne). Sdílené
 *  mezi UI (šipka) a backendem (fallback), ať se nerozejdou. */
export const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  relevance: 'desc',
  title: 'asc',
  artist: 'asc',
  downloads: 'desc',
  newest: 'desc',
  length: 'desc'
}

export interface FilterOption {
  id: string
  label: string
}

/** Volby do dropdownů advanced panelu (z RhythmVerse číselníku). */
export interface FilterOptions {
  genre: FilterOption[]
  instrument: FilterOption[]
  difficulty: FilterOption[]
  decade: FilterOption[]
  year: FilterOption[]
  songLength: FilterOption[]
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
  | 'canceled'

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
  /** Ruční škála UI (multiplikátor nad základem). 1 = výchozí. Násobí se s Windows DPI scalingem. */
  uiScale: number
  hotkeys: HotkeyConfig
  /** Rotující tipy v horní liště (discoverability snadno přehlédnutelných funkcí). */
  showTips: boolean
  /** Zobrazit malý reminder pill přes hru, když CH běží. */
  showReminder: boolean
  /** Roh obrazovky, kde se reminder zobrazí. */
  reminderPosition: ReminderPosition
  /** Poslední složka, kam se přesouvaly duplicity („Move to folder" místo koše). */
  dupMoveDir: string
  /**
   * Šablona názvu/umístění složky chartu, `/` = podsložky uvnitř Songs.
   * Viz `shared/foldertemplate.ts`. Výchozí `{artist} - {title}` = formát, který
   * appka používala natvrdo, takže beze změny nastavení se chování nemění.
   */
  folderTemplate: string
  /**
   * true = neptat se na cílovou složku, rovnou použít `folderTemplate`.
   * false (výchozí) = ukázat TargetFolderModal jako dosud.
   */
  autoTargetFolder: boolean
}

export type RhythmVerseSystem = 'ch' | 'ps' | 'rb3' | 'all'

/** Zdrojová databáze chartů. */
export type Database = 'rhythmverse' | 'enchor' | 'both'

/** Položka ve správci knihovny (složka/soubor). */
export interface LibEntry {
  name: string
  type: 'dir' | 'file'
  isSong: boolean
  /** Velikost souboru v bajtech (u složek 0 — velikost se dopočítává jinak). */
  size: number
  /** Čas poslední změny (ms epoch) — pro řazení „naposledy změněné". */
  mtimeMs: number
  /** Čas vytvoření (ms epoch) — pro řazení „naposledy přidané". */
  birthtimeMs: number
}

export interface LibListing {
  path: string
  entries: LibEntry[]
}

/** Detailní info o písni z knihovny (pro bohaté řádky v Library manageru). */
export interface LibSongInfo {
  rel: string
  title: string
  artist: string
  charter: string
  album: string
  genre: string
  year: number | null
  lengthSeconds: number | null
  difficulties: InstrumentDifficulties
}

/** Detail otevřené písně: metadata + obal alba jako data URI (nebo null). */
export interface SongDetail {
  info: LibSongInfo | null
  albumArt: string | null
}

/** Editovatelná metadata písně (song.ini). */
export interface SongMeta {
  name?: string
  artist?: string
  album?: string
  genre?: string
  year?: string
  charter?: string
}

/** Píseň ve výsledku hledání duplicit. */
/** Co navíc má složka kopie (pro rozhodnutí, kterou verzi si nechat). */
export interface DupExtras {
  background: boolean
  highway: boolean
  video: boolean
  /** Vícestopé audio (guitar/bass/drums… ne jen song.ogg) — lze ztlumit svůj part. */
  stems: boolean
  albumArt: boolean
}

export interface DupSong {
  rel: string
  name: string
  artist: string
  title: string
  charter: string
  extras: DupExtras
}

/** Skupina duplicit: `identical` = bajtově shodné, `same-song` = jiné verze téže písně. */
export interface DupGroup {
  reason: 'identical' | 'same-song'
  songs: DupSong[]
}

/** Playlist (.setlist) — název + počet písní. */
export interface PlaylistInfo {
  name: string
  count: number
}

/** Píseň v setlistu, rozřešená proti knihovně (`found:false` = v knihovně není). */
export interface PlaylistSong {
  hash: string
  artist: string
  title: string
  found: boolean
}

/** Výsledek přidání písní do playlistu. */
export interface PlaylistAddResult {
  added: number
  skipped: number
  missingHash: number
  total: number
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

/** Výsledek ruční kontroly aktualizací (tlačítko „Check for updates"). */
export interface UpdateCheckResult {
  /** available = je novější verze, uptodate = máš poslední, error = nešlo zkontrolovat. */
  status: 'available' | 'uptodate' | 'error'
  /** Verze — u `available` ta nová, u `uptodate` aktuální. */
  version?: string
  canAutoUpdate?: boolean
  url?: string
}

export interface ReleaseNotes {
  version: string
  name: string
  /** Markdown tělo poznámek k vydání z GitHubu. */
  body: string
  url: string
  /** ISO datum vydání (published_at) — pro zobrazení u víceverzového changelogu. */
  date?: string
}

/** API vystavené do renderer procesu přes contextBridge (window.api). */
export interface RendererApi {
  /** OS, na kterém běžíme — renderer podle toho ladí UI (mac vs Windows). */
  platform: NodeJS.Platform
  search(
    text: string,
    page: number,
    records: number,
    system?: RhythmVerseSystem,
    database?: Database,
    filters?: SearchFilters,
    sort?: SortKey,
    sortDir?: SortDir
  ): Promise<SearchResponse>
  /** Volby filtrů (žánry, dekády, roky…) pro advanced panel; z RhythmVerse číselníku. */
  getFilterOptions(system?: RhythmVerseSystem): Promise<FilterOptions>
  /** Načte skladby z odkazu na playlist (v1: veřejný Spotify přes embed). */
  resolvePlaylist(url: string): Promise<PlaylistResolveResult>
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
  /** Relativní cesty (k Songs) položek odpovídajících písni (duplikáty = víc než jedna). */
  ownedFolders(artist: string, title: string): Promise<string[]>
  // Správce knihovny
  libList(rel: string): Promise<LibListing>
  /** Počty písní v PODsložkách dané složky (song složka = 1). Async — pro odznaky. */
  libFolderCounts(rel: string): Promise<Record<string, number>>
  libCreateFolder(rel: string, name: string): Promise<void>
  libRename(relItem: string, newName: string): Promise<void>
  libTrash(relItem: string): Promise<void>
  /** Přesune položky knihovny do složky MIMO knihovnu (karanténa duplicit — funguje i tam, kde koš ne, např. Wine). */
  libMoveOut(relItems: string[], destAbsDir: string): Promise<void>
  libMove(src: string, destDir: string): Promise<void>
  libCopy(src: string, destDir: string): Promise<void>
  libOpen(rel: string): void
  libReveal(relItem: string): void
  /** Přečte metadata (song.ini) písně. */
  libReadMeta(relItem: string): Promise<SongMeta>
  /** Detailní info (obtížnosti, charter, délka…) pro dávku písní. */
  libSongInfo(rels: string[]): Promise<LibSongInfo[]>
  /** Detail otevřené písně (metadata + obal alba jako data URI). */
  libSongDetail(rel: string): Promise<SongDetail>
  /** Zapíše zadaná metadata do song.ini. */
  libWriteMeta(relItem: string, fields: SongMeta): Promise<void>
  /** Najde duplicity v knihovně (identické + varianty téže písně). */
  /** `scope` = relativní podsložky Songs; prázdné/neuvedené = celá knihovna. */
  libFindDuplicates(scope?: string[]): Promise<DupGroup[]>
  /** Vypíše Clone Hero playlisty (.setlist). */
  libListPlaylists(): Promise<PlaylistInfo[]>
  /** Přidá písně do playlistu (vytvoří / doplní existující). */
  libAddToPlaylist(name: string, relItems: string[]): Promise<PlaylistAddResult>
  /** Smaže celý playlist. */
  libDeletePlaylist(name: string): Promise<void>
  /** Přejmenuje playlist. */
  libRenamePlaylist(oldName: string, newName: string): Promise<void>
  /** Vrátí písně v playlistu, rozřešené proti knihovně. */
  libPlaylistSongs(name: string): Promise<PlaylistSong[]>
  /** Odebere z playlistu písně podle hashů. */
  libRemoveFromPlaylist(name: string, hashes: string[]): Promise<void>
  getJobs(): Promise<DownloadJob[]>
  clearFinishedJobs(): Promise<void>
  cancelJob(id: string): Promise<void>
  cancelAllJobs(): Promise<void>
  onJobUpdate(cb: (job: DownloadJob) => void): () => void
  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  /** True if the configured Songs folder exists. */
  songsDirExists(): Promise<boolean>
  chooseDirectory(defaultPath?: string): Promise<string | null>
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
  /** Přepne maximalizaci hlavního okna. */
  toggleMaximize(): void
  /** Aktuální stav maximalizace (počáteční ikona tlačítka). */
  isMaximized(): Promise<boolean>
  /** Odběr změn stavu maximalizace (přepnutí ikony). Vrací unsubscribe. */
  onMaximizeChange(cb: (max: boolean) => void): () => void
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
  /** Ruční kontrola aktualizací (bez restartu). U instalační verze vyvolá i update banner. */
  checkForUpdates(): Promise<UpdateCheckResult>
  /** Živě přepne škálu UI (náhled z Nastavení; trvale se uloží přes config). */
  setUiScale(scale: number): Promise<void>
  /** Poznámky k vydání dané (nebo aktuální) verze z GitHubu. */
  getReleaseNotes(version?: string): Promise<ReleaseNotes | null>
  /**
   * Poznámky k více vydáním. Se `since` vrátí vše novější než ta verze (co
   * uživatel od svého updatu minul), jinak posledních `max` vydání.
   */
  getReleaseNotesSince(since?: string, max?: number): Promise<ReleaseNotes[]>
  /** 30s zvuková ukázka spárovaná podle interpreta + názvu (iTunes → Deezer). */
  preview(artist: string, title: string): Promise<PreviewResult>
}

/** Výsledek hledání zvukové ukázky (30s klip oficiální nahrávky). */
export interface PreviewResult {
  ok: boolean
  /** MIME typ audia (audio/mp4, audio/mpeg…). */
  mime?: string
  /** Bajty 30s ukázky (přehrají se v rendereru přes blob URL). */
  data?: ArrayBuffer
  /** Co se reálně spárovalo — pro popisek „přehrávám: …". */
  matchedArtist?: string
  matchedTitle?: string
  /** Zdroj ukázky (atribuce / ladění). */
  source?: 'itunes' | 'deezer'
  /** Důvod při ok=false: 'notfound' = nespárováno, 'error' = síť/stažení selhalo. */
  reason?: 'notfound' | 'error'
}
