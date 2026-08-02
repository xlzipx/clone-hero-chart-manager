// Lokální katalog metadat chartů (SQLite přes better-sqlite3).
//
// Drží ořezaná metadata VŠECH chartů obou databází (RhythmVerse ~140k,
// Chorus Encore ~94k) v jednom DB souboru v userData. Díky tomu umí filtry,
// které živá API neumí (charter/album u obou, žánr/rok/tier u Encore) — a to
// přes CELÝ katalog, ne jen načtenou stránku. Plnění a aktualizace řeší
// `catalogsync.ts`; tenhle modul je čistá DB vrstva (schéma + upsert + dotazy).
//
// Pozn. k paměti: data NIKDY nedržíme jako JS pole v paměti (235k objektů by
// nafouklo heap o stovky MB). SQLite drží vše na disku a dotazy jedou přes
// indexy / scan v řádu ms — main proces si nechává jen prepared statements.

import Database from 'better-sqlite3'
import type {
  CatalogQuery,
  InstrumentDifficulties,
  SearchResponse,
  SongResult,
  SortDir,
  SortKey
} from '../../shared/types'
import { SORT_DEFAULT_DIR } from '../../shared/types'
import { mergeKey } from '../../shared/songid'
import { stripRichTags } from './songmeta'

/** Zdroj řádku v katalogu. */
export type CatalogSource = 'rv' | 'en'

/** Jeden řádek pro upsert: normalizovaná píseň + identita a čas změny. */
export interface CatalogItem {
  src: CatalogSource
  /** Stabilní id v rámci zdroje (rv: file_id, en: chartId). */
  uid: string
  /** Čas poslední změny na serveru (ms epoch) — pro delta sync a sort newest. */
  modifiedMs: number
  song: SongResult
}

let db: Database.Database | null = null

/** Pořadí sloupců obtížností — sdílené mezi INSERT a rekonstrukcí. */
const DIFF_KEYS: (keyof InstrumentDifficulties)[] = [
  'guitar',
  'bass',
  'drums',
  'vocals',
  'keys',
  'proGuitar',
  'proBass',
  'proKeys',
  'guitarghl',
  'bassghl',
  'band'
]

const SCHEMA = `
CREATE TABLE IF NOT EXISTS charts (
  src TEXT NOT NULL,
  uid TEXT NOT NULL,
  key TEXT NOT NULL,
  file_id INTEGER,
  song_id INTEGER,
  title TEXT NOT NULL COLLATE NOCASE,
  artist TEXT NOT NULL COLLATE NOCASE,
  album TEXT NOT NULL COLLATE NOCASE,
  genre TEXT NOT NULL COLLATE NOCASE,
  year INTEGER,
  length_s INTEGER,
  art TEXT,
  d_guitar INTEGER, d_bass INTEGER, d_drums INTEGER, d_vocals INTEGER,
  d_keys INTEGER, d_proguitar INTEGER, d_probass INTEGER, d_prokeys INTEGER,
  d_guitarghl INTEGER, d_bassghl INTEGER, d_band INTEGER,
  expert_only INTEGER,
  charter TEXT,
  charter_plain TEXT COLLATE NOCASE,
  merge_key TEXT NOT NULL DEFAULT '',
  host TEXT,
  gameformat TEXT,
  gameformats TEXT NOT NULL DEFAULT '[]',
  needs_conversion INTEGER NOT NULL DEFAULT 0,
  official INTEGER NOT NULL DEFAULT 0,
  download_url TEXT,
  download_page_url TEXT,
  external_url TEXT,
  drive_folder_url TEXT,
  size_bytes INTEGER,
  downloads INTEGER,
  modified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (src, uid)
);
CREATE INDEX IF NOT EXISTS idx_charts_artist ON charts(artist);
CREATE INDEX IF NOT EXISTS idx_charts_title ON charts(title);
CREATE INDEX IF NOT EXISTS idx_charts_modified ON charts(src, modified DESC);
CREATE INDEX IF NOT EXISTS idx_charts_format ON charts(src, gameformat);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** Otevře (nebo založí) katalogovou DB. Volat jednou při startu appky. */
export function initCatalog(dbPath: string): void {
  if (db) return
  db = new Database(dbPath)
  // WAL: zápisy syncu neblokují souběžné čtecí dotazy z UI.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(SCHEMA)
  migrate(db)
}

/** Migrace starších DB (seed/katalog z předchozí verze schématu). `CREATE
 *  TABLE IF NOT EXISTS` existující tabulku nemění, takže nové sloupce se
 *  musí doplnit ručně — a dopočítat, protože upsert je plní jen u nových řádků. */
function migrate(d: Database.Database): void {
  const cols = (d.pragma('table_info(charts)') as { name: string }[]).map((c) => c.name)
  if (!cols.includes('merge_key')) {
    d.exec(`ALTER TABLE charts ADD COLUMN merge_key TEXT NOT NULL DEFAULT ''`)
  }
  // Indexy až TADY (ne ve SCHEMA) — na staré DB by odkazovaly na sloupec,
  // který vznikne teprve migrací o řádek výš. Pro čerstvou DB jsou no-op.
  // (merge_key, src) pokrývá NOT EXISTS sondu dedupu „Both"; `modified` bez
  // src umožňuje řadit newest-first globálně (složený (src,modified) to neumí).
  d.exec('CREATE INDEX IF NOT EXISTS idx_charts_mergekey_src ON charts(merge_key, src)')
  d.exec('CREATE INDEX IF NOT EXISTS idx_charts_modified_all ON charts(modified)')
  // Dopočet prázdných merge_key (nový sloupec i případný přerušený dopočet).
  // mergeKey je JS funkce (sdílená s mergeBoth) → řádky projít v JS; ~235k
  // řádků zabere jednotky sekund JEDNORÁZOVĚ při prvním otevření po migraci.
  const missing = (
    d.prepare(`SELECT COUNT(*) n FROM charts WHERE merge_key = ''`).get() as { n: number }
  ).n
  if (missing === 0) return
  const rows = d
    .prepare(`SELECT rowid, artist, title, charter FROM charts WHERE merge_key = ''`)
    .all() as { rowid: number; artist: string; title: string; charter: string | null }[]
  const upd = d.prepare('UPDATE charts SET merge_key = ? WHERE rowid = ?')
  const run = d.transaction(() => {
    for (const r of rows) {
      upd.run(mergeKeyOf(r.artist, r.title, r.charter), r.rowid)
    }
  })
  run()
  console.log(`[catalog] migrated merge_key for ${rows.length} rows`)
}

/** mergeKey ze sloupců (sdílená sémantika s shared/songid.mergeKey). */
function mergeKeyOf(artist: string, title: string, charter: string | null): string {
  return mergeKey({ artist, title, charter } as Parameters<typeof mergeKey>[0])
}

/** Zavře DB (při ukončení appky — ať WAL soubor korektně dosedne). Checkpoint
 *  slije WAL do hlavního souboru → po zavření zbývá jediný .db (nutné pro
 *  seed generátor, příjemné pro zálohy). */
export function closeCatalog(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* checkpoint je best-effort */
  }
  db.close()
  db = null
}

/**
 * První spuštění: když ještě neexistuje žádná lokální DB, rozbalí PŘIBALENÝ
 * seed katalogu (gzip v resources, ~40 MB → ~140 MB) — uživatel pak nestaví
 * katalog po stránkách z API, jen delta sync dožene, co přibylo od buildu
 * instalátoru. Přes dočasný soubor + rename, ať přerušené rozbalení nenechá
 * rozbitou půlku tvářící se jako hotová DB. Chybějící seed (dev) není chyba.
 */
export async function ensureCatalogSeed(dbPath: string, seedGzPath: string): Promise<void> {
  const { existsSync, createReadStream, createWriteStream } = await import('fs')
  const { rename, rm } = await import('fs/promises')
  const { createGunzip } = await import('zlib')
  const { pipeline } = await import('stream/promises')

  if (existsSync(dbPath) || !existsSync(seedGzPath)) return
  const tmp = dbPath + '.seed'
  try {
    await pipeline(createReadStream(seedGzPath), createGunzip(), createWriteStream(tmp))
    await rename(tmp, dbPath)
    console.log('[catalog] seeded from bundled snapshot')
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    // Nevadí — bez seedu se katalog prostě postaví z API jako dřív.
    console.warn('[catalog] seed unpack failed, will build from API:', err)
  }
}

function need(): Database.Database {
  if (!db) throw new Error('Catalog DB is not initialized')
  return db
}

// ── meta ──────────────────────────────────────────────────────────────────

export function getMeta(key: string): string | null {
  const row = need().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  need().prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
}

export function delMeta(key: string): void {
  need().prepare('DELETE FROM meta WHERE key = ?').run(key)
}

// ── upsert ────────────────────────────────────────────────────────────────

const INSERT_SQL = `INSERT OR REPLACE INTO charts (
  src, uid, key, file_id, song_id, title, artist, album, genre, year,
  length_s, art,
  d_guitar, d_bass, d_drums, d_vocals, d_keys, d_proguitar, d_probass,
  d_prokeys, d_guitarghl, d_bassghl, d_band,
  expert_only, charter, charter_plain, merge_key, host, gameformat, gameformats,
  needs_conversion, official, download_url, download_page_url, external_url,
  drive_folder_url, size_bytes, downloads, modified
) VALUES (${new Array(39).fill('?').join(', ')})`

function toRow(it: CatalogItem): unknown[] {
  const s = it.song
  return [
    it.src,
    it.uid,
    s.key,
    s.fileId,
    s.songId,
    s.title,
    s.artist,
    s.album,
    s.genre,
    s.year,
    s.lengthSeconds,
    s.albumArtUrl,
    ...DIFF_KEYS.map((k) => s.difficulties[k] ?? null),
    s.expertOnly === null ? null : s.expertOnly ? 1 : 0,
    s.charter,
    s.charter ? stripRichTags(s.charter) : null,
    mergeKey(s),
    s.source,
    s.gameFormat,
    JSON.stringify(s.gameFormats),
    s.needsConversion ? 1 : 0,
    s.official ? 1 : 0,
    s.downloadUrl,
    s.downloadPageUrl,
    s.externalUrl,
    s.driveFolderUrl ?? null,
    s.sizeBytes,
    s.downloads,
    it.modifiedMs
  ]
}

/** Cache COUNT(*) výsledků dotazů — počty se mění jen syncem (invalidace v
 *  upsertMany). Klíč = WHERE + parametry. */
const countCache = new Map<string, number>()

/** Dávkový upsert (jedna transakce). Vrací počet zapsaných řádků. */
export function upsertMany(items: CatalogItem[]): number {
  if (items.length === 0) return 0
  countCache.clear() // data se mění → uložené počty přestávají platit
  const d = need()
  const stmt = d.prepare(INSERT_SQL)
  const run = d.transaction((rows: CatalogItem[]) => {
    for (const r of rows) stmt.run(...toRow(r))
  })
  run(items)
  return items.length
}

/** Počty řádků per zdroj (pro status UI). */
export function counts(): { rv: number; en: number } {
  const d = need()
  const rows = d.prepare('SELECT src, COUNT(*) n FROM charts GROUP BY src').all() as {
    src: string
    n: number
  }[]
  const out = { rv: 0, en: 0 }
  for (const r of rows) {
    if (r.src === 'rv') out.rv = r.n
    else if (r.src === 'en') out.en = r.n
  }
  return out
}

// ── dotazy ────────────────────────────────────────────────────────────────

interface ChartRow {
  src: string
  key: string
  file_id: number | null
  song_id: number | null
  title: string
  artist: string
  album: string
  genre: string
  year: number | null
  length_s: number | null
  art: string | null
  d_guitar: number | null
  d_bass: number | null
  d_drums: number | null
  d_vocals: number | null
  d_keys: number | null
  d_proguitar: number | null
  d_probass: number | null
  d_prokeys: number | null
  d_guitarghl: number | null
  d_bassghl: number | null
  d_band: number | null
  expert_only: number | null
  charter: string | null
  host: string | null
  gameformat: string | null
  gameformats: string
  needs_conversion: number
  official: number
  download_url: string | null
  download_page_url: string | null
  external_url: string | null
  drive_folder_url: string | null
  size_bytes: number | null
  downloads: number | null
}

function rowToSong(r: ChartRow): SongResult {
  const diffs: InstrumentDifficulties = {}
  const cols = [
    r.d_guitar,
    r.d_bass,
    r.d_drums,
    r.d_vocals,
    r.d_keys,
    r.d_proguitar,
    r.d_probass,
    r.d_prokeys,
    r.d_guitarghl,
    r.d_bassghl,
    r.d_band
  ]
  DIFF_KEYS.forEach((k, i) => {
    const v = cols[i]
    if (v !== null) diffs[k] = v
  })
  return {
    key: r.key,
    fileId: r.file_id,
    songId: r.song_id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    year: r.year,
    genre: r.genre,
    lengthSeconds: r.length_s,
    albumArtUrl: r.art,
    difficulties: diffs,
    expertOnly: r.expert_only === null ? null : r.expert_only === 1,
    charter: r.charter,
    source: r.host,
    gameFormat: r.gameformat,
    gameFormats: JSON.parse(r.gameformats),
    needsConversion: r.needs_conversion === 1,
    official: r.official === 1,
    downloadUrl: r.download_url,
    downloadPageUrl: r.download_page_url,
    externalUrl: r.external_url,
    sizeBytes: r.size_bytes,
    downloads: r.downloads,
    driveFolderUrl: r.drive_folder_url
  }
}

/** `song_length` id (RV číselník) → rozsah sekund. Hranice dle labelů
 *  („< 3 min.", „3-5", „5-7", „7-10", „10+"), polouzavřené ať se nepřekrývají. */
const LENGTH_RANGES: Record<string, [number, number | null]> = {
  short_range: [0, 180],
  medium_range: [180, 300],
  long_range: [300, 420],
  extralong_range: [420, 600],
  epic_range: [600, null]
}

/** Escapování LIKE vzoru (%, _ jsou žolíky; \ je náš escape znak). */
function likeArg(sub: string): string {
  return '%' + sub.replace(/[\\%_]/g, (c) => '\\' + c) + '%'
}

const INST_COL: Record<string, string> = {
  guitar: 'd_guitar',
  bass: 'd_bass',
  drums: 'd_drums',
  vocals: 'd_vocals',
  keys: 'd_keys'
}

/**
 * Dotaz do katalogu. Sémanticky kopíruje živé vyhledávání (viz `search` v
 * ipc.ts) + klientské filtry z App.tsx, jen nad úplným lokálním katalogem:
 *  - database: rhythmverse/enchor = jen daný zdroj; both = oba (řazené dohromady)
 *  - system omezuje JEN rv řádky (Encore je celý CH) — stejně jako živé API
 *  - text: každé slovo musí sedět v title/artist/album (lepší než RV fulltext,
 *    který neumí „interpret + název" v jednom dotazu)
 *  - PS3 řádky v katalogu nejsou (sync je zahazuje jako živé API)
 */
export function queryCatalog(q: CatalogQuery): SearchResponse {
  const d = need()
  const where: string[] = []
  const args: unknown[] = []

  if (q.database === 'rhythmverse') {
    where.push(`src = 'rv'`)
  } else if (q.database === 'enchor') {
    where.push(`src = 'en'`)
  }

  // System filtr platí jen na rv řádky (mapa slug → gameformat ověřená živě:
  // ch → 'ch', ps → 'ps', rb3 → 'rb3*'; all → bez omezení).
  if (q.system !== 'all') {
    const fmt =
      q.system === 'rb3' ? `gameformat LIKE 'rb3%'` : `gameformat = '${q.system}'`
    where.push(`(src != 'rv' OR ${fmt})`)
  }

  const text = q.text?.trim()
  if (text) {
    for (const term of text.split(/\s+/)) {
      where.push(`(title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\' OR album LIKE ? ESCAPE '\\')`)
      const arg = likeArg(term)
      args.push(arg, arg, arg)
    }
  }

  if (q.genreLabels?.length) {
    where.push(`genre IN (${q.genreLabels.map(() => '?').join(',')})`)
    args.push(...q.genreLabels)
  }
  if (q.year?.length) {
    const nums = q.year.map((y) => parseInt(y, 10)).filter(Number.isFinite)
    if (nums.length) {
      where.push(`year IN (${nums.map(() => '?').join(',')})`)
      args.push(...nums)
    }
  }
  if (q.decade?.length) {
    const parts: string[] = []
    for (const dec of q.decade) {
      const start = parseInt(dec, 10)
      if (!Number.isFinite(start)) continue
      parts.push('(year BETWEEN ? AND ?)')
      args.push(start, start + 9)
    }
    if (parts.length) where.push(`(${parts.join(' OR ')})`)
  }
  if (q.songLength?.length) {
    const parts: string[] = []
    for (const id of q.songLength) {
      const range = LENGTH_RANGES[id]
      if (!range) continue
      if (range[1] === null) {
        parts.push('(length_s >= ?)')
        args.push(range[0])
      } else {
        parts.push('(length_s >= ? AND length_s < ?)')
        args.push(range[0], range[1])
      }
    }
    if (parts.length) where.push(`(${parts.join(' OR ')})`)
  }

  const charter = q.charter?.trim()
  if (charter) {
    where.push(`charter_plain LIKE ? ESCAPE '\\'`)
    args.push(likeArg(charter))
  }
  const album = q.album?.trim()
  if (album) {
    where.push(`album LIKE ? ESCAPE '\\'`)
    args.push(likeArg(album))
  }

  // Tier rozsah + nástroje — stejná sémantika jako klientský filtr v App.tsx:
  // vybrané nástroje musí být nacharované a v rozsahu; bez výběru nástroje při
  // zúženém rozsahu stačí JAKÝKOLI z pěti hlavních nástrojů v rozsahu.
  const min = q.diffMin ?? 0
  const max = q.diffMax ?? 6
  const narrowed = min > 0 || max < 6
  const insts = (q.instruments ?? []).map((i) => INST_COL[i]).filter(Boolean)
  if (insts.length) {
    for (const col of insts) {
      where.push(`${col} IS NOT NULL AND ${col} BETWEEN ? AND ?`)
      args.push(min, max)
    }
  } else if (narrowed) {
    const any = Object.values(INST_COL)
      .map((col) => `(${col} IS NOT NULL AND ${col} BETWEEN ? AND ?)`)
      .join(' OR ')
    for (let i = 0; i < Object.keys(INST_COL).length; i++) args.push(min, max)
    where.push(`(${any})`)
  }

  // Řazení. 'relevance' (bez uživatelské volby) = nejnovější první — stabilní
  // a smysluplný browse default. NULL hodnoty (downloads u Encore, délka…)
  // řadíme na konec, ať nezaplaví první stránky.
  const sort: SortKey = q.sort ?? 'relevance'
  const dir: SortDir = q.sortDir ?? SORT_DEFAULT_DIR[sort]
  const sql = dir === 'asc' ? 'ASC' : 'DESC'
  let orderSql: string
  switch (sort) {
    case 'title':
      orderSql = `ORDER BY title ${sql}, artist ASC`
      break
    case 'artist':
      orderSql = `ORDER BY artist ${sql}, title ASC`
      break
    case 'length':
      orderSql = `ORDER BY length_s IS NULL, length_s ${sql}, artist ASC`
      break
    case 'downloads':
      orderSql = `ORDER BY downloads IS NULL, downloads ${sql}, artist ASC`
      break
    case 'newest':
    case 'relevance':
    default:
      orderSql = `ORDER BY modified ${sort === 'relevance' ? 'DESC' : sql}, artist ASC`
      break
  }

  // „Both": stejná píseň v obou DB = jeden řádek — stejná sémantika jako
  // mergeBoth v shared/songid (klíč artist|title|charter; přednost má Encore,
  // VÝJIMKA „Most downloaded" — Encore počty stažení nemá, tak vede RV).
  // Dedup přes NOT EXISTS (řádek podřazeného zdroje se schová, když existuje
  // preferovaný se stejným merge_key) — na rozdíl od GROUP BY nemusí SQLite
  // sestavit a seřadit všechny skupiny, jen sonduje index (merge_key, src)
  // podél řazení → stránka je hotová po pár tisících sondách, ne 700 ms.
  if (q.database === 'both') {
    const prefSrc = sort === 'downloads' ? 'rv' : 'en'
    // Řádek je vidět, jen když ho žádný jiný se stejným merge_key „nepřebíjí":
    // (a) řádek preferovaného DRUHÉHO zdroje (Encore/RV pravidlo výš), nebo
    // (b) novější řádek TÉHOŽ zdroje (mergeBoth dedupuje i uvnitř zdroje —
    //     např. tentýž song ve víc RV formátech). Tiebreak rowid = determinismus.
    where.push(
      `NOT EXISTS (SELECT 1 FROM charts c2 WHERE c2.merge_key = charts.merge_key AND (
        (c2.src != charts.src AND c2.src = '${prefSrc}') OR
        (c2.src = charts.src AND (c2.modified > charts.modified OR (c2.modified = charts.modified AND c2.rowid > charts.rowid)))
      ))`
    )
  }
  const whereSqlFinal = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // COUNT musí projít celou filtrovanou množinu (u „Both" s dedup sondou je to
  // znát) → malá cache; počty se mění jen syncem, který ji invaliduje.
  const countKey = JSON.stringify([whereSqlFinal, args])
  let total = countCache.get(countKey)
  if (total === undefined) {
    total = (
      d.prepare(`SELECT COUNT(*) n FROM charts ${whereSqlFinal}`).get(...args) as { n: number }
    ).n
    if (countCache.size > 200) countCache.clear()
    countCache.set(countKey, total)
  }

  const page = Math.max(1, q.page)
  const records = Math.max(1, q.records)
  const rows = d
    .prepare(`SELECT * FROM charts ${whereSqlFinal} ${orderSql} LIMIT ? OFFSET ?`)
    .all(...args, records, (page - 1) * records) as ChartRow[]

  return {
    songs: rows.map(rowToSong),
    totalFiltered: total,
    resultCount: total,
    page,
    records
  }
}
