// Hledání duplicit v knihovně Songs. Dvě úrovně:
//   - 'identical'  = bajtově shodný chart (stejné MD5 notes.chart/mid) → přebytky
//                    lze bezpečně smazat.
//   - 'same-song'  = stejný umělec|název, ale RŮZNÉ verze (jiný charter/chart) →
//                    ať rozhodne uživatel.
//
// Kvůli výkonu hashujeme jen KANDIDÁTY: nejdřív levně načteme metadata a
// seskupíme podle názvu; MD5 počítáme jen u písní, které s někým sdílí název.

import { promises as fsp } from 'fs'
import { basename, join, relative, resolve, sep } from 'path'
import { getConfig } from './config'
import { readSongMeta, stripRichTags } from './songmeta'
import { songHash } from './playlists'
import { normText } from '../../shared/songid'
import type { DupExtras, DupGroup, DupSong } from '../../shared/types'

const SONG_MARKERS = ['song.ini', 'notes.chart', 'notes.mid']

// Audio stopy, které CH pozná jako samostatné party (víc stop = lze ztlumit
// svůj nástroj; „song.ogg" samotné je jen jeden mix). „song"/„preview"/„crowd"
// se nepočítají jako party.
const STEM_AUDIO = /^(guitar|guitar_1|guitar_2|bass|rhythm|drums|drums_1|drums_2|drums_3|drums_4|vocals|vocals_1|vocals_2|keys)\.(ogg|opus|mp3|wav)$/i

/** Zjistí „extras" složky z už načteného výpisu (žádné další I/O). */
function detectExtras(entries: import('fs').Dirent[]): DupExtras {
  const ex: DupExtras = {
    background: false,
    highway: false,
    video: false,
    stems: false,
    albumArt: false
  }
  for (const e of entries) {
    if (!e.isFile()) continue
    const n = e.name.toLowerCase()
    if (/^background\d*\.(png|jpg|jpeg)$/.test(n) || n === 'bg.png') ex.background = true
    else if (/^highway\.(png|jpg|jpeg)$/.test(n)) ex.highway = true
    else if (/\.(mp4|webm|avi|m4v|mpe?g)$/.test(n)) ex.video = true
    else if (/^album\.(png|jpg|jpeg|webp)$/.test(n)) ex.albumArt = true
    else if (STEM_AUDIO.test(n)) ex.stems = true
  }
  return ex
}

// Normalizace textu = sdílený `normText` (shared/songid.ts).
const norm = normText

function splitFolderName(name: string): { artist: string; title: string } {
  const d = name.indexOf(' - ')
  if (d > 0) return { artist: name.slice(0, d).trim(), title: name.slice(d + 3).trim() }
  return { artist: '', title: name.trim() }
}

interface RawSong extends DupSong {
  abs: string
}

/**
 * Projde knihovnu a vrátí skupiny duplicit (nejdřív identické, pak varianty).
 *
 * `scope` = relativní podsložky Songs, ve kterých hledat. Prázdné/neuvedené =
 * CELÁ knihovna (výchozí chování). Duplicity se pak hledají jen NAPŘÍČ vybranými
 * složkami — což je smysl volby: „projeď mi jen 1 Downloads".
 */
export async function findDuplicates(scope?: string[]): Promise<DupGroup[]> {
  const songsDir = getConfig().songsDir
  const all: RawSong[] = []

  // BEZPEČNOST: rozsah chodí z rendereru přes IPC → nesmí utéct z knihovny
  // (`..`, absolutní cesta). Stejný princip jako guard v `install()`.
  const baseAbs = resolve(songsDir)
  const roots = (scope ?? [])
    .map((r) => resolve(songsDir, r))
    .filter((abs) => abs === baseAbs || abs.startsWith(baseAbs + sep))
  const scanRoots = roots.length > 0 ? roots : [songsDir]

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
      // Hodnoty SYROVĚ (RichText v UI vykreslí tagy barevně); pro PÁROVÁNÍ se
      // tagy stripují níž v klíči — jinak by norm() nechal „colororange…"
      // a otagovaná kopie by se nespárovala s čistou.
      const title = (meta.name || fallback.title || '').trim()
      if (title) {
        all.push({
          abs: dir,
          rel: relative(songsDir, dir).split(sep).join('/'),
          name: basename(dir),
          artist: (meta.artist || fallback.artist || '').trim(),
          title,
          charter: (meta.charter || '').trim(),
          extras: detectExtras(entries)
        })
      }
      return // do podsložek písně už nelez
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name), depth + 1)
    }
  }
  for (const root of scanRoots) await walk(root, 0)
  // Kdyby se rozsahy překrývaly (vybraná složka i její podsložka, nebo tatáž
  // dvakrát), prošla by se píseň víckrát a spárovala by se sama se sebou =
  // FALEŠNÝ duplikát. Dedup podle cesty to uzavře pro všechny takové případy.
  const seen = new Set<string>()
  const unique = all.filter((s) => (seen.has(s.rel) ? false : (seen.add(s.rel), true)))
  all.length = 0
  all.push(...unique)

  // Seskup podle umělec|název; unikáty vynech (nemají s čím být duplicitní).
  const byTitle = new Map<string, RawSong[]>()
  for (const s of all) {
    const k = `${norm(stripRichTags(s.artist))}|${norm(stripRichTags(s.title))}`
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
    charter: s.charter,
    extras: s.extras
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
