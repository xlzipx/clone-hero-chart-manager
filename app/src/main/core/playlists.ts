// Clone Hero playlisty (.setlist). Formát zreverzován z komunitního nástroje
// ExternalSetlistCreator (funkční, hra ho hraje):
//
//   Hlavička:   EA EC 33 01                (4 B)
//   Počet:      uint16 little-endian       (2 B)
//   Rezerva:    00 00                      (2 B)
//   Per píseň:
//     0x20                                 (1 B oddělovač)
//     MD5 hex UPPERCASE souboru notes.chart/notes.mid jako 32 ASCII bajtů
//     rychlost %: int32 little-endian      (4 B, default 100)
//     0x00                                 (1 B)
//
// Píseň se identifikuje MD5 syrového `notes.chart` (preferováno) nebo `notes.mid`.
// CH si hash spáruje s naskenovanou knihovnou — do songcache.bin sahat nemusíme.
// Setlisty leží v `Documents\Clone Hero\Setlists\<název>.setlist`.

import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, promises as fsp } from 'fs'
import { basename, join } from 'path'
import type { PlaylistAddResult, PlaylistInfo } from '../../shared/types'

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

/** Serializuje seznam hashů do .setlist bufferu. */
export function encodeSetlist(hashes: string[], speed = 100): Buffer {
  const parts: Buffer[] = [HEADER]
  const count = Buffer.alloc(2)
  count.writeUInt16LE(hashes.length & 0xffff, 0)
  parts.push(count, Buffer.from([0x00, 0x00]))
  for (const h of hashes) {
    const sp = Buffer.alloc(4)
    sp.writeInt32LE(speed, 0)
    parts.push(Buffer.from([0x20]), Buffer.from(h, 'utf-8'), sp, Buffer.from([0x00]))
  }
  return Buffer.concat(parts)
}

/** Rozparsuje .setlist buffer zpět na seznam hashů (pro append/dedupe). */
export function decodeSetlist(buf: Buffer): string[] {
  const hashes: string[] = []
  if (buf.length < 8 || !buf.subarray(0, 4).equals(HEADER)) return hashes
  let off = 8 // header(4) + count(2) + rezerva(2)
  while (off + 1 + ENTRY_HASH_LEN + 4 + 1 <= buf.length) {
    if (buf[off] !== 0x20) break
    off += 1
    hashes.push(buf.subarray(off, off + ENTRY_HASH_LEN).toString('utf-8'))
    off += ENTRY_HASH_LEN + 4 + 1 // hash + speed + 0x00
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

  await fsp.writeFile(file, encodeSetlist(existing))
  return { added, skipped, missingHash, total: existing.length }
}

/** Smaže celý setlist. */
export async function deletePlaylist(name: string): Promise<void> {
  const file = join(setlistsDir(), `${sanitizeSetlistName(name)}.setlist`)
  await fsp.rm(file, { force: true })
}
