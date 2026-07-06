// Hledání duplicit v knihovně Songs. Dvě úrovně:
//   - 'identical'  = bajtově shodný chart (stejné MD5 notes.chart/mid) → přebytky
//                    lze bezpečně smazat.
//   - 'same-song'  = stejný umělec|název, ale RŮZNÉ verze (jiný charter/chart) →
//                    ať rozhodne uživatel.
//
// Kvůli výkonu hashujeme jen KANDIDÁTY: nejdřív levně načteme metadata a
// seskupíme podle názvu; MD5 počítáme jen u písní, které s někým sdílí název.

import { promises as fsp } from 'fs'
import { basename, join, relative, sep } from 'path'
import { getConfig } from './config'
import { readSongMeta, stripRichTags } from './songmeta'
import { songHash } from './playlists'
import type { DupGroup, DupSong } from '../../shared/types'

const SONG_MARKERS = ['song.ini', 'notes.chart', 'notes.mid']

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function splitFolderName(name: string): { artist: string; title: string } {
  const d = name.indexOf(' - ')
  if (d > 0) return { artist: name.slice(0, d).trim(), title: name.slice(d + 3).trim() }
  return { artist: '', title: name.trim() }
}

interface RawSong extends DupSong {
  abs: string
}

/** Projde knihovnu a vrátí skupiny duplicit (nejdřív identické, pak varianty). */
export async function findDuplicates(): Promise<DupGroup[]> {
  const songsDir = getConfig().songsDir
  const all: RawSong[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && SONG_MARKERS.includes(e.name.toLowerCase()))) {
      const meta = await readSongMeta(dir)
      const fallback = splitFolderName(basename(dir))
      // stripRichTags: CH barevné tagy (<color=…>) by (1) v UI ukazovaly syrové
      // značky a (2) rozbily porovnání názvů — norm() by nechal „colororange…".
      const title = stripRichTags(meta.name || fallback.title || '')
      if (title) {
        all.push({
          abs: dir,
          rel: relative(songsDir, dir).split(sep).join('/'),
          name: basename(dir),
          artist: stripRichTags(meta.artist || fallback.artist || ''),
          title,
          charter: stripRichTags(meta.charter || '')
        })
      }
      return // do podsložek písně už nelez
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name), depth + 1)
    }
  }
  await walk(songsDir, 0)

  // Seskup podle umělec|název; unikáty vynech (nemají s čím být duplicitní).
  const byTitle = new Map<string, RawSong[]>()
  for (const s of all) {
    const k = `${norm(s.artist)}|${norm(s.title)}`
    const arr = byTitle.get(k)
    if (arr) arr.push(s)
    else byTitle.set(k, [s])
  }

  const groups: DupGroup[] = []
  const strip = (s: RawSong): DupSong => ({
    rel: s.rel,
    name: s.name,
    artist: s.artist,
    title: s.title,
    charter: s.charter
  })

  for (const candidates of byTitle.values()) {
    if (candidates.length < 2) continue
    // Hashuj jen tyhle kandidáty.
    const hashes = new Map<RawSong, string | null>()
    for (const s of candidates) hashes.set(s, await songHash(s.abs))

    // Identické podskupiny (stejný ne-null hash).
    const byHash = new Map<string, RawSong[]>()
    for (const s of candidates) {
      const h = hashes.get(s)
      if (!h) continue
      const arr = byHash.get(h)
      if (arr) arr.push(s)
      else byHash.set(h, [s])
    }
    for (const arr of byHash.values()) {
      if (arr.length > 1) groups.push({ reason: 'identical', songs: arr.map(strip) })
    }

    // „Stejná píseň, jiná verze" — jen když existuje víc než jedna distinktní verze
    // (jinak jde čistě o identické kopie, ty řeší sekce výše).
    const distinct = new Set(candidates.map((s) => hashes.get(s) ?? `null:${s.rel}`))
    if (distinct.size > 1) groups.push({ reason: 'same-song', songs: candidates.map(strip) })
  }

  // Identické první, pak varianty; uvnitř podle názvu.
  groups.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === 'identical' ? -1 : 1
    return (a.songs[0]?.title || '').localeCompare(b.songs[0]?.title || '', 'cs')
  })
  return groups
}
