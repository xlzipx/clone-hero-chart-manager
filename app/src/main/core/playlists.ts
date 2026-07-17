// Clone Hero playlisty (.setlist). Formát OVĚŘEN bajt po bajtu proti setlistu,
// který vytvořila přímo hra Clone Hero v1.1.0 (ground truth):
//
//   Hlavička:   EA EC 33 01                (4 B)
//   Počet:      uint32 little-endian       (4 B)
//   Per píseň (35 B):
//     0x20                                 (1 B oddělovač)
//     MD5 hex UPPERCASE souboru notes.chart/notes.mid jako 32 ASCII bajtů
//     rychlost %: JEDEN bajt               (1 B, default 100 = 0x64)
//     0x00                                 (1 B)
//
// Píseň se identifikuje MD5 syrového `notes.chart` (preferováno) nebo `notes.mid`,
// UPPERCASE hex. CH si hash spáruje s naskenovanou knihovnou (songcache.bin) — do
// ní sahat nemusíme. Nový setlist CH uvidí až po restartu (čte je při startu).
// Setlisty leží v `Documents\Clone Hero\Setlists\<název>.setlist`.
//
// POZOR: komunitní nástroj ExternalSetlistCreator používá pro rychlost int32
// (4 B) — to je špatně, CH má 1 bajt. Nekopírovat odtud.

import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, promises as fsp } from 'fs'
import { basename, join } from 'path'
import { getConfig } from './config'
import { readSongMeta } from './songmeta'
import type { PlaylistAddResult, PlaylistInfo, PlaylistSong } from '../../shared/types'

const SONG_MARKERS = ['song.ini', 'notes.chart', 'notes.mid']

const HEADER = Buffer.from([0xea, 0xec, 0x33, 0x01])
const ENTRY_HASH_LEN = 32

/** Složka, kam Clone Hero ukládá setlisty. */
export function setlistsDir(): string {
  return join(app.getPath('documents'), 'Clone Hero', 'Setlists')
}

function sanitizeSetlistName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()
  if (!clean) throw new Error('Invalid playlist name')
  return clean.slice(0, 100)
}

// ── Serializace zápisů ──────────────────────────────────────────────────
// Operace nad setlistem jsou read-modify-write; dvě souběžná IPC volání by se
// navzájem přepsala (poslední writeFile vyhraje). Per-soubor promise řetěz je
// serializuje. Chyba jedné operace nesmí rozbít řetěz (proto .catch).
const fileLocks = new Map<string, Promise<unknown>>()

function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  fileLocks.set(key, next)
  // Úklid, ať mapa neroste donekonečna.
  void next.catch(() => {}).finally(() => {
    if (fileLocks.get(key) === next) fileLocks.delete(key)
  })
  return next
}

/** Atomický zápis (tmp + rename) — pád uprostřed nezanechá useknutý .setlist. */
async function writeSetlistAtomic(file: string, buf: Buffer): Promise<void> {
  const tmp = file + '.tmp'
  await fsp.writeFile(tmp, buf)
  await fsp.rename(tmp, file)
}

/** MD5 hex (uppercase) písně z `notes.chart` (preferováno) / `notes.mid`. */
export async function songHash(folderAbs: string): Promise<string | null> {
  for (const f of ['notes.chart', 'notes.mid']) {
    try {
      const buf = await fsp.readFile(join(folderAbs, f))
      return createHash('md5').update(buf).digest('hex').toUpperCase()
    } catch {
      /* zkus druhý */
    }
  }
  return null
}

/** Jeden zápis v setlistu: hash písně + její rychlost v % (1 bajt, 100 = default). */
export interface SetlistEntry {
  hash: string
  speed: number
}

/** Serializuje zápisy (hash + rychlost) do .setlist bufferu (přesně jako CH). */
export function encodeSetlistEntries(entries: SetlistEntry[]): Buffer {
  const parts: Buffer[] = [HEADER]
  const count = Buffer.alloc(4)
  count.writeUInt32LE(entries.length >>> 0, 0)
  parts.push(count)
  for (const e of entries) {
    parts.push(
      Buffer.from([0x20]),
      Buffer.from(e.hash, 'utf-8'), // 32 ASCII hex (uppercase)
      Buffer.from([e.speed & 0xff]), // rychlost jako 1 bajt (100 = 0x64)
      Buffer.from([0x00])
    )
  }
  return Buffer.concat(parts)
}

/** Serializuje seznam hashů (všem stejná rychlost) — zpětně kompatibilní wrapper. */
export function encodeSetlist(hashes: string[], speed = 100): Buffer {
  return encodeSetlistEntries(hashes.map((h) => ({ hash: h, speed })))
}

/** Rozparsuje .setlist buffer na zápisy vč. rychlosti (zachová per-song speed). */
export function decodeSetlistEntries(buf: Buffer): SetlistEntry[] {
  const out: SetlistEntry[] = []
  if (buf.length < 8 || !buf.subarray(0, 4).equals(HEADER)) return out
  let off = 8 // header(4) + count(4)
  while (off + 1 + ENTRY_HASH_LEN + 1 + 1 <= buf.length) {
    if (buf[off] !== 0x20) break
    off += 1
    const hash = buf.subarray(off, off + ENTRY_HASH_LEN).toString('utf-8')
    const speed = buf[off + ENTRY_HASH_LEN] // bajt hned za hashem
    out.push({ hash, speed })
    off += ENTRY_HASH_LEN + 1 + 1 // hash + speed(1) + 0x00
  }
  return out
}

/** Rozparsuje .setlist buffer zpět na seznam hashů (pro count/procházení). */
export function decodeSetlist(buf: Buffer): string[] {
  return decodeSetlistEntries(buf).map((e) => e.hash)
}

/** Vypíše existující setlisty (název bez přípony + počet písní). */
export async function listPlaylists(): Promise<PlaylistInfo[]> {
  const dir = setlistsDir()
  let names: string[] = []
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const out: PlaylistInfo[] = []
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.setlist')) continue
    try {
      const buf = await fsp.readFile(join(dir, n))
      out.push({ name: basename(n, '.setlist'), count: decodeSetlist(buf).length })
    } catch {
      /* přeskoč nečitelné */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  return out
}

/**
 * Přidá písně (abs cesty ke složkám) do setlistu `name` — vytvoří nový, nebo
 * doplní existující. Duplicitní hashe se přeskočí. Vrátí souhrn.
 */
export async function addSongsToPlaylist(
  name: string,
  folderAbsList: string[]
): Promise<PlaylistAddResult> {
  const safe = sanitizeSetlistName(name)
  const dir = setlistsDir()
  await fsp.mkdir(dir, { recursive: true })
  const file = join(dir, `${safe}.setlist`)

  return withFileLock(file, async () => {
    // Načti existující zápisy (vč. rychlostí), ať doplňujeme a nic nezahodíme —
    // ani per-song rychlost, kterou si uživatel nastavil ve hře.
    let existing: SetlistEntry[] = []
    if (existsSync(file)) {
      try {
        existing = decodeSetlistEntries(await fsp.readFile(file))
      } catch {
        existing = []
      }
    }
    const seen = new Set(existing.map((e) => e.hash))

    let added = 0
    let skipped = 0
    let missingHash = 0
    for (const folder of folderAbsList) {
      const h = await songHash(folder)
      if (!h) {
        missingHash++
        continue
      }
      if (seen.has(h)) {
        skipped++
        continue
      }
      seen.add(h)
      existing.push({ hash: h, speed: 100 }) // nová píseň → default rychlost 100 %
      added++
    }

    await writeSetlistAtomic(file, encodeSetlistEntries(existing))
    return { added, skipped, missingHash, total: existing.length }
  })
}

/** Smaže celý setlist. */
export async function deletePlaylist(name: string): Promise<void> {
  const file = join(setlistsDir(), `${sanitizeSetlistName(name)}.setlist`)
  // Přes zámek, ať se nepotká s běžícím add/remove nad stejným souborem.
  return withFileLock(file, async () => {
    await fsp.rm(file, { force: true })
  })
}

/** Přejmenuje setlist (soubor). */
export async function renamePlaylist(oldName: string, newName: string): Promise<void> {
  const dir = setlistsDir()
  const src = join(dir, `${sanitizeSetlistName(oldName)}.setlist`)
  const dst = join(dir, `${sanitizeSetlistName(newName)}.setlist`)
  // Zámek na zdrojový soubor serializuje rename proti add/remove nad ním.
  return withFileLock(src, async () => {
    if (!existsSync(src)) throw new Error('Playlist not found')
    if (existsSync(dst)) throw new Error('A playlist with that name already exists')
    await fsp.rename(src, dst)
  })
}

/** Odebere ze setlistu písně podle hashů (přepíše soubor, zachová rychlosti). */
export async function removeSongsFromPlaylist(name: string, hashes: string[]): Promise<void> {
  const file = join(setlistsDir(), `${sanitizeSetlistName(name)}.setlist`)
  return withFileLock(file, async () => {
    const remove = new Set(hashes)
    const remaining = decodeSetlistEntries(await fsp.readFile(file)).filter(
      (e) => !remove.has(e.hash)
    )
    await writeSetlistAtomic(file, encodeSetlistEntries(remaining))
  })
}

// ── Rozřešení hash → píseň (pro zobrazení obsahu setlistu) ─────────────
// Index knihovny (hash → umělec/název) je drahý: MD5 se počítá z CELÉHO obsahu
// notes.chart/mid, což u velké knihovny znamená přečíst stovky MB z disku. Dvě
// vrstvy cache to krotí:
//   1) `indexCache` — hotová mapa v paměti, 5 min TTL (opakované otevření = instant)
//   2) `hashDiskCache` — PERZISTENTNÍ (userData) hash keyed cestou+mtime+velikostí
//      notes souboru → MD5 se přepočítá JEN pro nové/změněné písně. Tím přežije
//      restart appky i vyhození OS file-cache („po nějaké době") — první otevření
//      setlistu pak jen `stat`uje soubory (metadata z MFT, ~KB), místo aby četlo
//      stovky MB obsahu.
let indexCache: { at: number; map: Map<string, { artist: string; title: string }> } | null = null

interface HashCacheEntry {
  mtimeMs: number
  size: number
  hash: string
}
let hashDiskCache: Map<string, HashCacheEntry> | null = null

function hashCachePath(): string {
  return join(app.getPath('userData'), 'hash-index.json')
}

/** Načte perzistentní hash cache (jednou, pak z paměti). Poškozená = prázdná. */
async function loadHashCache(): Promise<Map<string, HashCacheEntry>> {
  if (hashDiskCache) return hashDiskCache
  try {
    const raw = await fsp.readFile(hashCachePath(), 'utf-8')
    const obj = JSON.parse(raw) as Record<string, HashCacheEntry>
    hashDiskCache = new Map(Object.entries(obj))
  } catch {
    hashDiskCache = new Map()
  }
  return hashDiskCache
}

/** Uloží hash cache (best-effort; selhání zápisu jen znamená přepočet příště). */
async function saveHashCache(map: Map<string, HashCacheEntry>): Promise<void> {
  hashDiskCache = map
  try {
    await writeSetlistAtomic(hashCachePath(), Buffer.from(JSON.stringify(Object.fromEntries(map))))
  } catch {
    /* nevadí */
  }
}

/**
 * Zneplatní cache indexu V PAMĚTI. Volat po každé změně obsahu knihovny
 * (instalace, smazání, přesun písně) a po změně `songsDir` — jinak by setlisty
 * až 5 minut neviděly nové/přesunuté písně. Perzistentní hash cache se NEMAŽE:
 * je klíčovaná cestou+mtime+velikostí, takže se sama zaktualizuje jen tam, kde
 * se soubor reálně změnil (a smazané písně z ní vypadnou při dalším průchodu).
 */
export function invalidateLibraryIndex(): void {
  indexCache = null
}

/** notes soubor písně (chart preferováno) + jeho mtime/velikost, nebo null. */
async function notesStat(
  dir: string
): Promise<{ path: string; mtimeMs: number; size: number } | null> {
  for (const f of ['notes.chart', 'notes.mid']) {
    const p = join(dir, f)
    try {
      const st = await fsp.stat(p)
      return { path: p, mtimeMs: st.mtimeMs, size: st.size }
    } catch {
      /* zkus druhý */
    }
  }
  return null
}

async function libraryHashIndex(): Promise<Map<string, { artist: string; title: string }>> {
  if (indexCache && Date.now() - indexCache.at < 5 * 60 * 1000) return indexCache.map
  const songsDir = getConfig().songsDir
  const oldCache = await loadHashCache()
  // `nextCache` obsahuje JEN písně viděné teď → smazané samy vypadnou (prune).
  const nextCache = new Map<string, HashCacheEntry>()
  const map = new Map<string, { artist: string; title: string }>()
  let changed = false

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && SONG_MARKERS.includes(e.name.toLowerCase()))) {
      const st = await notesStat(dir)
      if (st) {
        // Hash závisí JEN na obsahu notes souboru → když mtime+velikost sedí
        // s cache, MD5 přeskočíme (to je ta drahá část = přečíst celý soubor).
        const cached = oldCache.get(st.path)
        let h: string | null
        if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
          h = cached.hash
        } else {
          h = await songHash(dir)
          changed = true
        }
        if (h) {
          nextCache.set(st.path, { mtimeMs: st.mtimeMs, size: st.size, hash: h })
          // Metadata (artist/title) čteme vždy: song.ini je malé (~KB), takže i
          // celá knihovna je pár MB, a zůstanou tak vždy aktuální i po editaci.
          const meta = await readSongMeta(dir)
          const fb = basename(dir)
          const dash = fb.indexOf(' - ')
          // Syrově vč. tagů — RichText v UI je vykreslí barevně jako hra.
          map.set(h, {
            artist: (meta.artist || (dash > 0 ? fb.slice(0, dash) : '')).trim(),
            title: (meta.name || (dash > 0 ? fb.slice(dash + 3) : fb)).trim()
          })
        }
      }
      return
    }
    for (const e of entries) if (e.isDirectory()) await walk(join(dir, e.name), depth + 1)
  }
  await walk(songsDir, 0)

  // Ulož jen když se něco pohnulo (nový/změněný hash) nebo ubyly písně — jinak
  // zbytečný zápis při každém otevření.
  if (changed || nextCache.size !== oldCache.size) void saveHashCache(nextCache)
  indexCache = { at: Date.now(), map }
  return map
}

/** Písně v setlistu, rozřešené proti knihovně (nenalezené = `found:false`). */
export async function getPlaylistSongs(name: string): Promise<PlaylistSong[]> {
  const file = join(setlistsDir(), `${sanitizeSetlistName(name)}.setlist`)
  let hashes: string[]
  try {
    hashes = decodeSetlist(await fsp.readFile(file))
  } catch {
    return []
  }
  const idx = await libraryHashIndex()
  return hashes.map((h) => {
    const e = idx.get(h)
    return { hash: h, artist: e?.artist ?? '', title: e?.title ?? '', found: !!e }
  })
}
