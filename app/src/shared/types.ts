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
  /** Kdy chart v databázi přibyl nebo byl naposledy změněn (ms epoch). RV
   *  `update_date`, Encore `modifiedTime`; ani jedna nerozlišuje přidání a úpravu. */
  updatedMs?: number | null
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

/**
 * Stav lokálního katalogu metadat (SQLite index obou databází pro rychlé
 * filtrování bez sítě — viz main/core/catalog.ts).
 *  - empty   = ještě neproběhl žádný úplný sync (katalog se nepoužívá)
 *  - syncing = právě probíhá stahování/aktualizace (progress 0..1)
 *  - ready   = úplný sync hotový, katalog se používá pro dotazy
 */
/** Stav jednoho zdroje katalogu. `ready` = plný build doběhl → tenhle zdroj
 *  lze dotazovat (nezávisle na druhém — Encore se staví první a naskočí dřív). */
export interface CatalogSourceStatus {
  ready: boolean
  /** Průběh plného buildu 0..1 (mimo build drží 1). */
  progress: number
}

export interface CatalogStatus {
  state: 'empty' | 'syncing' | 'ready'
  /** True = OBA zdroje hotové. Per-zdroj použitelnost viz `sources` (Encore
   *  bývá hotový dřív). Zůstává true i během delta syncu (state='syncing'). */
  usable: boolean
  /** Kombinovaný průběh běžícího syncu 0..1 (mimo `syncing` drží 1). */
  progress: number
  /** Per-zdroj stav (rv = RhythmVerse, en = Chorus Encore). */
  sources: { rv: CatalogSourceStatus; en: CatalogSourceStatus }
  /** Počty řádků per zdroj. */
  counts: { rv: number; en: number }
  /** Čas posledního DOKONČENÉHO syncu (ms epoch), null = nikdy. */
  lastSync: number | null
  /** Právě běží dlouhá operace (první build / obnova celého katalogu). */
  longRun?: boolean
}

/**
 * Dotaz do lokálního katalogu. Významově kopíruje parametry `search` + klientské
 * filtry, které server neumí (charter/album/tier) — katalog je umí všechny,
 * protože má celé katalogy obou DB lokálně.
 */
/** Filtr „Added/modified": předvolba nebo vlastní rozsah (YYYY-MM-DD). */
export interface DateFilter {
  preset: 'any' | '1d' | '7d' | '30d' | '90d' | '365d' | 'custom'
  from: string
  to: string
}

/** Rozsah v ms pro DateFilter; null = bez omezení. */
export function dateFilterRange(f: DateFilter, now = Date.now()): { from?: number; to?: number } | null {
  const DAY = 86_400_000
  const days: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 }
  if (f.preset === 'any') return null
  if (f.preset !== 'custom') return { from: now - days[f.preset] * DAY }
  const from = f.from ? Date.parse(`${f.from}T00:00:00`) : NaN
  const to = f.to ? Date.parse(`${f.to}T23:59:59.999`) : NaN
  if (!Number.isFinite(from) && !Number.isFinite(to)) return null
  return {
    ...(Number.isFinite(from) ? { from } : {}),
    ...(Number.isFinite(to) ? { to } : {})
  }
}

/** Kopírovaná / přesouvaná píseň, která už v cílové složce je. */
export interface ExistingMatch {
  rel: string
  /** Název kopírované složky. */
  name: string
  /** Název složky v cíli, se kterou se shoduje. */
  match: string
  /** identical = stejný soubor s notami, same-song = stejný interpret a název, jiný chart. */
  kind: 'identical' | 'same-song'
}

/** Další složka s charty mimo Songs. `id` je předpona cest v ní (`::id/…`). */
export interface ExtraFolderInfo {
  id: string
  path: string
  name: string
}

export interface CatalogQuery {
  /** Fulltext přes title+artist+album (každé slovo musí sedět někde). */
  text?: string
  database: Database
  /** Omezuje jen RhythmVerse řádky (Encore je vždy CH) — stejně jako živé API. */
  system: RhythmVerseSystem
  /** Labely žánrů (katalog ukládá zobrazované řetězce, ne RV id). */
  genreLabels?: string[]
  year?: string[]
  decade?: string[]
  songLength?: string[]
  /** Přesné jméno interpreta (case-insensitive) — klik na interpreta ve výsledcích. */
  artist?: string
  /** Podřetězec jména chartera (case-insensitive, bez <color=…> tagů). */
  charter?: string
  /** Přesný název alba (bez ohledu na velikost písmen). */
  album?: string
  /** Vybrané nástroje — každý musí být nacharovaný a v tier rozsahu. */
  instruments?: string[]
  diffMin?: number
  diffMax?: number
  /** Filtr redukcí: 'expert' = jen Expert-only charty, 'full' = jen E/M/H/X. */
  reductions?: 'expert' | 'full'
  /** Jen přímo stažitelné (bez official DLC a MEGA/Mediafire/zkracovačů). */
  directOnly?: boolean
  /** Skrýt písně, které už uživatel má v knihovně (dle setOwnedKeys). */
  excludeOwned?: boolean
  /** Přidáno / upraveno v databázi od–do (ms epoch, včetně). */
  updatedFrom?: number
  updatedTo?: number
  sort?: SortKey
  sortDir?: SortDir
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
  /** Poslední zvolená databáze a systém — obnoví se po restartu appky. */
  database: Database
  system: RhythmVerseSystem
  /** Poslední stav přepínačů „Hide owned" / „Direct downloads only" (v liště výsledků). */
  hideOwned: boolean
  directOnly: boolean
  /** Vyrovnávat hlasitost skladeb v přehrávači (EBU R128, konstantní gain — nemění dynamiku). */
  normalizeLoudness: boolean
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
  /** Omezit animace a přechody (slabší stroje, citlivost na pohyb). */
  reduceMotion: boolean
  /** Nižší řádky výsledků hledání (menší obal, bez popisků nástrojů). */
  compactRows: boolean
  /** Hlasitost zvukových ukázek (0–1). */
  previewVolume: number
  /** Zobrazit malý reminder pill přes hru, když CH běží. */
  showReminder: boolean
  /** Roh obrazovky, kde se reminder zobrazí. */
  reminderPosition: ReminderPosition
  /** Poslední složka, kam se přesouvaly duplicity („Move to folder" místo koše). */
  dupMoveDir: string
  /** Duplicity, různé verze: upřednostnit verzi s těmito nástroji (guitar/bass/…). */
  dupPreferInstruments: string[]
  /** Další složky s charty mimo Songs (archiv na jiném disku…), absolutní cesty. */
  extraFolders: string[]
  /** Setlisty: kompaktní seznam bez obalů. */
  setlistCompact: boolean
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
  /**
   * Zapnout kontrolu nových verzí při startu appky. true (výchozí) = jako dosud —
   * po pár sekundách proběhne check a když je novější verze, vyskočí banner
   * v levém spodním rohu. false = při startu nic; nová verze se zjistí jen po
   * ručním kliknutí na „Check for updates" v Nastavení / v postranním pruhu.
   */
  autoCheckUpdates: boolean
  /** Zobrazení písní v Library: karty (obal, obtížnosti, ukázka) nebo kompaktní seznam. */
  libraryView: 'cards' | 'list'
  /** Poslední řazení v Library (klíč z nabídky řazení + směr), obnoví se po restartu. */
  librarySort: { key: string; dir: 1 | -1 }
  /** Poslední poloha a velikost hlavního okna (DIP); null = výchozí uprostřed. */
  windowState: { x: number; y: number; width: number; height: number; maximized: boolean } | null
  /** Chart z Chorus Encore: 'folder' = rozbalit do složky písně (výchozí,
   *  jako .zip z webu Encore), 'sng' = nechat jeden .sng soubor (Clone Hero
   *  v1+ ho čte přímo). */
  encoreFormat: 'folder' | 'sng'
  /** Stahovat videa na pozadí (video.mp4 …). false = po stažení se smažou;
   *  platí pro RhythmVerse i Encore, ne pro soubory přetažené z disku. */
  downloadVideos: boolean
  /** Kolik stažení běží naráz (1–4). */
  maxConcurrentDownloads: number
  /** Hotová stažení zmizí z fronty samy po pár sekundách (jinak zůstanou do Clear). */
  autoClearFinished: boolean
  /** Co se stane se smazanými složkami: koš (lze obnovit) / trvalé smazání. */
  deleteMode: 'trash' | 'permanent'
}

export type RhythmVerseSystem = 'ch' | 'ps' | 'rb3' | 'all'

/** Zdrojová databáze chartů. */
export type Database = 'rhythmverse' | 'enchor' | 'both'

export type LibProblem = 'chart' | 'audio' | 'both'

/** Položka ve správci knihovny (složka/soubor). */
export interface LibEntry {
  name: string
  type: 'dir' | 'file'
  isSong: boolean
  /** Rozbitá složka písně, co v ní chybí: 'chart' = notes.mid / notes.chart,
   *  'audio' = zvukové stopy, 'both' = obojí (zbyl jen song.ini). Clone Hero ji
   *  nezahraje. Typicky nedokončený převod nebo stahování. */
  problem?: LibProblem
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
  /** Složka písně v knihovně (relativně k Songs), jen u nalezených. */
  rel?: string
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
  /** Rozbalí .sng do složky písně vedle něj; .sng jde do koše. Vrací rel nové složky. */
  libUnpackSng(relItem: string): Promise<string>
  /** Rozbité písně ve složce a všech podsložkách; `name` = cesta relativně k `rel`. */
  libFindBroken(rel: string): Promise<LibEntry[]>
  /** Další složky s charty (cesty v nich mají předponu `::id`). */
  libExtraFolders(): Promise<ExtraFolderInfo[]>
  libAddExtraFolder(absPath: string): Promise<ExtraFolderInfo>
  libRemoveExtraFolder(id: string): Promise<void>
  /** Které z písní už v cílové složce jsou (před kopírováním / přesunem). */
  libFindExisting(srcRels: string[], destRel: string): Promise<ExistingMatch[]>
  /** „Fix it": rozbitou složku do koše, nově staženou na její místo. */
  libReplaceBroken(brokenRel: string, installAbs: string): Promise<string>
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
  /** Malé náhledy obalů (JPEG data URI ~112 px) pro karty v Library; null = bez obalu. */
  libAlbumThumbs(rels: string[]): Promise<Record<string, string | null>>
  /** Větší obaly (~320 px) pro stoh vybraných písní v pravém panelu. */
  libAlbumCovers(rels: string[]): Promise<Record<string, string | null>>
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
  /** Okno appky je aktivní (v popředí a viditelné) / v pozadí. */
  onWindowActive(cb: (active: boolean) => void): () => void
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
  /** Údržba v Nastavení. */
  catalogSyncNow(): Promise<void>
  catalogRefreshAll(): Promise<void>
  settingsExport(): Promise<boolean>
  settingsImport(): Promise<AppConfig | null>
  openDataFolder(): Promise<void>
  /** Velikost mezipaměti Chromia v bajtech (obaly alb, ukázky). */
  cacheSize(): Promise<number>
  /** Vyčistí mezipaměť; vrací novou velikost. */
  cacheClear(): Promise<number>
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
  /** Poznámky ke všem vydáním aktuální minor řady (od x.y.0 po nainstalovanou). */
  getReleaseNotesMilestone(): Promise<ReleaseNotes[]>
  // ---- Lokální katalog metadat ----
  /** Aktuální stav katalogu (empty/syncing/ready + progress + počty). */
  catalogStatus(): Promise<CatalogStatus>
  /** Odběr změn stavu katalogu (průběh syncu, dokončení). Vrací unsubscribe. */
  onCatalogStatus(cb: (s: CatalogStatus) => void): () => void
  /** Dotaz do lokálního katalogu (jen když je `ready`; jinak vyhodí chybu). */
  catalogQuery(q: CatalogQuery): Promise<SearchResponse>
  /** Žánry z lokálního katalogu (obě DB), nejčastější první — našeptávač filtru. */
  catalogGenres(): Promise<{ label: string; count: number }[]>
  /** Nastaví normalizované klíče vlastněných písní pro katalogový „Hide owned". */
  catalogSetOwned(keys: string[]): Promise<void>
  /** 30s zvuková ukázka spárovaná podle interpreta + názvu (iTunes → Deezer). */
  preview(artist: string, title: string): Promise<PreviewResult>
  /** Zvuk už stažené písně (stopy + odkud pouštět ukázku). `rel` je cesta v knihovně. */
  songAudio(rel: string): Promise<SongAudio>
  /** Skutečná ukázka přímo z chartu na Encore. `null` = nepovedlo se, zkus online. */
  sngPreview(url: string): Promise<SngPreview | null>
  /** Rekurzivně vyjmenuje VŠECHNY písně (song složky) pod danou složkou knihovny —
   *  pro přehrávač „Listen as a playlist". Metadata bez obalu (ten se dohrává líně). */
  playerListFolder(rel: string): Promise<PlayerTrack[]>
  /** Písně setlistu jako fronta pro přehrávač (jen nalezené v knihovně, v pořadí). */
  playerListPlaylist(name: string): Promise<PlayerTrack[]>
  /** Cache naměřené hlasitosti písně (LUFS + peak). `null` = nezměřeno nebo se
   *  soubory od měření změnily (renderer pak přeměří a uloží přes `loudnessSet`). */
  loudnessGet(rel: string): Promise<{ lufs: number; peak: number } | null>
  /** Uloží naměřenou hlasitost písně do cache (renderer měří přes Web Audio). */
  loudnessSet(rel: string, lufs: number, peak: number): Promise<void>
}

/** Jedna položka fronty přehrávače (odkaz na složku písně + základní metadata). */
export interface PlayerTrack {
  /** Cesta ke složce písně relativně ke knihovně (pro `songAudio`/`libSongDetail`). */
  rel: string
  title: string
  artist: string
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

/**
 * Skutečná ukázka vytažená přímo z `.sng` na Chorus Encore (ne spárovaný klip
 * z hudební služby). Bajty jdou rovnou do přehrávače, nikam se neukládají.
 */
export interface SngPreview {
  data: ArrayBuffer
  mime: string
  /** true = hraje se od začátku skladby (chart neměl `preview_start_time`). */
  fromStart: boolean
}

/** Jedna zvuková stopa písně v knihovně (URL na vlastním schématu `chm-audio://`). */
export interface SongAudioTrack {
  /** Název souboru (guitar.ogg, song.ogg…) — jen pro ladění a popisky. */
  name: string
  url: string
}

/**
 * Zvuk písně, kterou už máme staženou. Když má chart rozdělené stopy, je jich
 * `tracks` víc a musí se přehrát SOUČASNĚ — samotné `song.ogg` je u takového
 * chartu jen doprovod bez nástrojů.
 */
export interface SongAudio {
  tracks: SongAudioTrack[]
  /** `preview_start_time` ze song.ini v ms — odkud ukázku pouštět (null = od začátku). */
  previewStartMs: number | null
}
