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
import { readSongMeta, stripRichTags } from './songmeta'
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

/** Serializuje seznam hashů do .setlist bufferu (přesně jako CH). */
export function encodeSetlist(hashes: string[], speed = 100): Buffer {
  const parts: Buffer[] = [HEADER]
  const count = Buffer.alloc(4)
  count.writeUInt32LE(hashes.length >>> 0, 0)
  parts.push(count)
  for (const h of hashes) {
    parts.push(
      Buffer.from([0x20]),
      Buffer.from(h, 'utf-8'), // 32 ASCII hex (uppercase)
      Buffer.from([speed & 0xff]), // rychlost jako 1 bajt (100 = 0x64)
      Buffer.from([0x00])
    )
  }
  return Buffer.concat(parts)
}

/** Rozparsuje .setlist buffer zpět na seznam hashů (pro append/dedupe/procházení). */
export function decodeSetlist(buf: Buffer): string[] {
  const hashes: string[] = []
  if (buf.length < 8 || !buf.subarray(0, 4).equals(HEADER)) return hashes
  let off = 8 // header(4) + count(4)
  while (off + 1 + ENTRY_HASH_LEN + 1 + 1 <= buf.length) {
    if (buf[off] !== 0x20) break
    off += 1
    hashes.push(buf.subarray(off, off + ENTRY_HASH_LEN).toString('utf-8'))
    off += ENTRY_HASH_LEN + 1 + 1 // hash + speed(1) + 0x00
  }
  return hashes
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
    // Načti existující hashe (když setlist už je), ať doplňujeme a nezahazujeme.
    let existing: string[] = []
    if (existsSync(file)) {
      try {
        existing = decodeSetlist(await fsp.readFile(file))
      } catch {
        existing = []
      }
    }
    const seen = new Set(existing)

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
      existing.push(h)
      added++
    }

    await writeSetlistAtomic(file, encodeSetlist(existing))
    return { added, skipped, missingHash, total: existing.length }
  })
}

/** Smaže celý setlist. */
export async function deletePlaylist(name: string): Promise<void> {
  const file = join(setlistsDir(), `${sanitizeSetlistName(name)}.setlist`)
  await fsp.rm(file, { force: true })
}

/** Přejmenuje setlist (soubor). */
export async function renamePlaylist(oldName: string, newName: string): Promise<void> {
  const dir = setlistsDir()
  const src = join(dir, `${sanitizeSetlistName(oldName)}.setlist`)
  const dst = join(dir, `${sanitizeSetlistName(newName)}.setlist`)
  if (!existsSync(src)) throw new Error('Playlist not found')
  if (existsSync(dst)) throw new Error('A playlist with that name already exists')
  await fsp.rename(src, dst)
}

/** Odebere ze setlistu písně podle hashů (přepíše soubor). */
export async function removeSongsFromPlaylist(name: string, hashes: string[]): Promise<void> {
  const file = join(setlistsDir(), `${sanitizeSetlistName(name)}.setlist`)
  return withFileLock(file, async () => {
    const remove = new Set(hashes)
    const remaining = decodeSetlist(await fsp.readFile(file)).filter((h) => !remove.has(h))
    await writeSetlistAtomic(file, encodeSetlist(remaining))
  })
}

// ── Rozřešení hash → píseň (pro zobrazení obsahu setlistu) ─────────────
// Index knihovny (hash → umělec/název) je drahý (hashuje všechny charty), proto
// se krátce cacheuje. Metadata (song.ini) hash NEMĚNÍ (ten je jen z notes.chart/
// mid), takže editace metadat cache neznehodnocuje; mění ji přidání/smazání písní.
let indexCache: { at: number; map: Map<string, { artist: string; title: string }> } | null = null

/**
 * Zneplatní cache indexu. Volat po každé změně obsahu knihovny (instalace,
 * smazání, přesun písně) a po změně `songsDir` — jinak by setlisty až 5 minut
 * neviděly nové/přesunuté písně.
 */
export function invalidateLibraryIndex(): void {
  indexCache = null
}

async function libraryHashIndex(): Promise<Map<string, { artist: string; title: string }>> {
  if (indexCache && Date.now() - indexCache.at < 5 * 60 * 1000) return indexCache.map
  const songsDir = getConfig().songsDir
  const map = new Map<string, { artist: string; title: string }>()
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && SONG_MARKERS.includes(e.name.toLowerCase()))) {
      const h = await songHash(dir)
      if (h) {
        const meta = await readSongMeta(dir)
        const fb = basename(dir)
        const dash = fb.indexOf(' - ')
        // stripRichTags: CH barevné tagy nepatří do zobrazovaných názvů.
        map.set(h, {
          artist: stripRichTags(meta.artist || (dash > 0 ? fb.slice(0, dash) : '')),
          title: stripRichTags(meta.name || (dash > 0 ? fb.slice(dash + 3) : fb))
        })
      }
      return
    }
    for (const e of entries) if (e.isDirectory()) await walk(join(dir, e.name), depth + 1)
  }
  await walk(songsDir, 0)
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
