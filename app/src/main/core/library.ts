// Instalace stažených/zkonvertovaných písní do knihovny Clone Hero (Songs).

import { existsSync, promises as fsp, readdirSync, statSync } from 'fs'
import { basename, join, relative, resolve, sep } from 'path'
import { getConfig } from './config'
import { invalidateLibraryIndex } from './playlists'
import { renderFolderTemplate } from '../../shared/foldertemplate'
import { songKey } from '../../shared/songid'
import type { SongResult } from '../../shared/types'

const SONG_MARKERS = ['song.ini', 'notes.chart', 'notes.mid']

function hasSongFiles(dir: string): boolean {
  try {
    const entries = readdirSync(dir).map((e) => e.toLowerCase())
    return SONG_MARKERS.some((m) => entries.includes(m))
  } catch {
    return false
  }
}

/** Vypíše prvních N souborů ve stromě – pro lepší error message. */
function listFirstFiles(root: string, max = 12): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number, rel: string): void => {
    if (depth > 4 || out.length >= max) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (out.length >= max) return
      const full = join(dir, name)
      const r = rel ? `${rel}/${name}` : name
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full, depth + 1, r)
      else out.push(r)
    }
  }
  walk(root, 0, '')
  return out
}

/** Najde všechny složky obsahující píseň (song.ini / notes.chart / notes.mid). */
export function findSongFolders(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return
    if (hasSongFiles(dir)) {
      found.push(dir)
      return // do podsložek písně už nelezeme
    }
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1)
      } catch {
        /* ignore */
      }
    }
  }
  walk(root, 0)
  return found
}

/** Najde volné .sng soubory (zabalený CH formát, který hra čte přímo). */
function findSngFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full, depth + 1)
      else if (st.isFile() && name.toLowerCase().endsWith('.sng')) found.push(full)
    }
  }
  const st = (() => {
    try {
      return statSync(root)
    } catch {
      return null
    }
  })()
  if (st?.isFile()) {
    if (root.toLowerCase().endsWith('.sng')) found.push(root)
  } else {
    walk(root, 0)
  }
  return found
}

// Klíč identity písně = `shared/songid.ts` (sdílený s rendererem, ať „In library"
// sedí). `normKey` byl dřív vlastní kopie — teď jen alias na sdílený `songKey`.
const normKey = songKey

/** "Artist - Title" → rozdělené; jinak title = celý název. */
function splitName(name: string): { artist: string; title: string } {
  const dash = name.indexOf(' - ')
  if (dash > 0) return { artist: name.slice(0, dash).trim(), title: name.slice(dash + 3).trim() }
  return { artist: '', title: name.trim() }
}

/** Async varianta `readIniMeta` (neblokuje event loop). */
async function readIniMetaAsync(folder: string): Promise<{ artist: string; title: string } | null> {
  try {
    const txt = await fsp.readFile(join(folder, 'song.ini'), 'utf-8')
    const name = /^\s*name\s*=\s*(.+)$/im.exec(txt)?.[1]?.trim()
    const artist = /^\s*artist\s*=\s*(.+)$/im.exec(txt)?.[1]?.trim()
    if (!name && !artist) return null
    return { artist: artist ?? '', title: name ?? '' }
  } catch {
    return null // song.ini chybí / nečitelný
  }
}

/**
 * Normalizované klíče (artist|title) všech písní v knihovně Songs — z názvů složek
 * a ze `song.ini` (rekurzivně, i podsložky) + volných .sng. Slouží jako NÁPOVĚDA
 * „tohle už asi máš" ve výsledcích hledání. Match není 100% (různé zápisy názvů).
 *
 * **Asynchronně (fs.promises), aby to NEBLOKOVALO main event loop** — u velkých
 * knihoven (tisíce písní) trval synchronní sken ~0,5–1 s a okno na tu dobu při
 * startu zamrzlo. Async čtení yielduje mezi FS operacemi, takže UI zůstane svižné.
 */
// ── Index knihovny: klíč (artist|title) → RELATIVNÍ cesty (k Songs) ───────
// Jeden sken slouží jak nápovědě „už mám" (klíče), tak funkci „odhal ve složce"
// (klik na In library → cesta/y). Krátká cache + invalidace po instalaci: u
// velkých knihoven je sken drahý, ale opakovaný badge/klik se trefí do cache.
let ownedIndexCache: { at: number; map: Map<string, string[]> } | null = null
const OWNED_TTL_MS = 60_000

async function buildOwnedIndex(): Promise<Map<string, string[]>> {
  const songsDir = getConfig().songsDir
  const map = new Map<string, string[]>()
  const add = (key: string, abs: string): void => {
    if (!key) return
    const rel = relative(songsDir, abs) || basename(abs)
    const arr = map.get(key)
    if (arr) arr.push(rel)
    else map.set(key, [rel])
  }
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    // Je to složka písně? (song.ini / notes.chart / notes.mid) → do podsložek už nelez.
    if (entries.some((e) => e.isFile() && SONG_MARKERS.includes(e.name.toLowerCase()))) {
      const meta = (await readIniMetaAsync(dir)) ?? splitName(basename(dir))
      if (meta.title) add(normKey(meta.artist, meta.title), dir)
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.sng')) {
        const { artist, title } = splitName(e.name.replace(/\.sng$/i, ''))
        if (title) add(normKey(artist, title), full)
      }
    }
  }
  await walk(songsDir, 0)
  return map
}

async function getOwnedIndex(): Promise<Map<string, string[]>> {
  if (ownedIndexCache && Date.now() - ownedIndexCache.at < OWNED_TTL_MS) return ownedIndexCache.map
  const map = await buildOwnedIndex()
  ownedIndexCache = { at: Date.now(), map }
  return map
}

/** Zneplatní cache indexu knihovny (po instalaci / změně Songs složky). */
export function invalidateOwnedIndex(): void {
  ownedIndexCache = null
}

/**
 * Normalizované klíče (artist|title) všech písní v knihovně Songs — z názvů složek
 * a ze `song.ini` (rekurzivně, i podsložky) + volných .sng. Slouží jako NÁPOVĚDA
 * „tohle už asi máš" ve výsledcích hledání. Match není 100% (různé zápisy názvů).
 *
 * **Asynchronně (fs.promises), aby to NEBLOKOVALO main event loop** — u velkých
 * knihoven trval synchronní sken ~0,5–1 s a okno na tu dobu při startu zamrzlo.
 */
export async function ownedSongKeys(): Promise<string[]> {
  return [...(await getOwnedIndex()).keys()]
}

/**
 * Relativní cesty (k Songs) všech položek knihovny odpovídajících dané písni
 * (artist|title). Víc než jedna = duplikáty; prázdné pole = není v knihovně.
 * Používá „In library" badge k odhalení složky v Průzkumníku.
 */
export async function ownedFolders(artist: string, title: string): Promise<string[]> {
  return (await getOwnedIndex()).get(normKey(artist, title)) ?? []
}

export function sanitize(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Unknown'
}

function uniqueDir(base: string): string {
  if (!existsSync(base)) return base
  let i = 2
  while (existsSync(`${base} (${i})`)) i++
  return `${base} (${i})`
}

/** Unikátní cesta pro soubor (zachová příponu): "name.sng" → "name (2).sng". */
function uniqueFile(dir: string, baseName: string, ext: string): string {
  let candidate = join(dir, `${baseName}${ext}`)
  if (!existsSync(candidate)) return candidate
  let i = 2
  while (existsSync(join(dir, `${baseName} (${i})${ext}`))) i++
  return join(dir, `${baseName} (${i})${ext}`)
}

export interface InstallResult {
  installedPaths: string[]
}

/** Vrátí názvy přímých podsložek v knihovně Songs (pro výběr cíle). */
export function listSongFolders(): string[] {
  const songsDir = getConfig().songsDir
  try {
    return readdirSync(songsDir)
      .filter((name) => {
        try {
          return statSync(join(songsDir, name)).isDirectory()
        } catch {
          return false
        }
      })
      .sort((a, b) => a.localeCompare(b, 'cs'))
  } catch {
    return []
  }
}

/**
 * Nainstaluje jednu nebo více písní z `sourceRoot` (rozbalený/zkonvertovaný obsah)
 * do knihovny. `subfolder` = volitelná cílová podsložka uvnitř Songs.
 * Vrací cesty nainstalovaných složek.
 */
export async function install(
  sourceRoot: string,
  song: SongResult,
  subfolder?: string
): Promise<InstallResult> {
  const baseSongsDir = getConfig().songsDir
  // Sanitizace případné podsložky (může obsahovat i vnořenou cestu od uživatele).
  // POZOR: prázdné segmenty musí pryč PŘED sanitizací — `sanitize('')` vrací
  // 'Unknown', takže Root ('') by jinak vytvořil složku „Unknown".
  // BEZPEČNOST: `sanitize` NEodstraňuje tečky, takže `..`/`.` by jako segment
  // prošly a `join` by utekl z knihovny (path traversal přes IPC z rendereru).
  // Proto je explicitně vyfiltrujeme a výslednou cestu ještě ověříme uvnitř base.
  const cleanSub = (subfolder ?? '')
    .split(/[\\/]/)
    .filter(Boolean)
    .map((p) => sanitize(p))
    .filter((p) => p && p !== '.' && p !== '..')
    .join('\\')
  // Šablona složky (nastavení): `dirs` = podsložky z šablony, `name` = název
  // složky chartu. Skládá se ZA ručně zvolenou podsložku, takže obojí jde
  // kombinovat. Výchozí šablona `{artist} - {title}` má `dirs` prázdné → cesta
  // vyjde identicky jako před zavedením šablon. Segmenty už jsou sanitizované a
  // bez `.`/`..` (viz `renderFolderTemplate`), traversal check dole to i tak ověří.
  const tpl = renderFolderTemplate(song, getConfig().folderTemplate)
  const songsDir = join(baseSongsDir, cleanSub, ...tpl.dirs)
  const baseAbs = resolve(baseSongsDir)
  const targetAbs = resolve(songsDir)
  if (targetAbs !== baseAbs && !targetAbs.startsWith(baseAbs + sep)) {
    throw new Error('Invalid target subfolder (must stay inside the Songs library).')
  }
  if (!existsSync(songsDir)) await fsp.mkdir(songsDir, { recursive: true })

  const installed: string[] = []
  const folders = findSongFolders(sourceRoot)

  if (folders.length > 0) {
    const single = folders.length === 1
    for (const folder of folders) {
      // U jediné písně použij název ze šablony (výchozí = „Artist - Title"); u packu
      // zachovej původní názvy — každá píseň v něm má vlastní metadata, která
      // v `song` (= záznam celého packu) nemáme, takže by šablona informace zničila.
      // Podsložky ze šablony (`tpl.dirs`) platí i pro packy — ty jsou už v `songsDir`.
      const folderName = single
        ? tpl.name
        : sanitize(folder.split(/[\\/]/).pop() || `${song.artist} - ${song.title}`)
      const dest = uniqueDir(join(songsDir, folderName))
      // Async kopie — písně mají velké .ogg stopy (desítky MB), cpSync by na tu
      // dobu zamrzl celé okno. `fsp.cp` yielduje.
      await fsp.cp(folder, dest, { recursive: true })
      installed.push(dest)
    }
    invalidateLibraryIndex() // nové písně musí být vidět v setlist manageru hned
    invalidateOwnedIndex() // a taky v „už mám / odhal ve složce"
    return { installedPaths: installed }
  }

  // Žádná složka s písní → zkus volné .sng soubory (CH je čte přímo).
  const sngs = findSngFiles(sourceRoot)
  if (sngs.length === 0) {
    const sample = listFirstFiles(sourceRoot)
    const sampleLower = sample.join(' ').toLowerCase()

    // Speciálně rozeznej raw PS3 RB obsah — `.mid_edat` (EDAT-šifrovaný MIDI)
    // a `.milo_ps3` (PS3-specifické animace). Tohle nelze v CH použít, ani
    // konvertovat bez Sony EDAT klíčů.
    if (/\.mid_edat\b|\.milo_ps3\b|songs\.dta/.test(sampleLower)) {
      throw new Error(
        'This is raw Rock Band 3 PS3 source content (encrypted .mid_edat / .milo_ps3 files), not a Clone Hero chart. It cannot be converted without Sony PS3 EDAT keys. Try the Xbox 360 or native Clone Hero version of this song instead.'
      )
    }

    const list =
      sample.length > 0 ? `\nFound files: ${sample.join(', ')}` : '\nThe archive appears to be empty.'
    throw new Error(
      `No song found in the content (looking for song.ini / notes.chart / notes.mid / .sng).${list}\nThis archive may not be Clone Hero–compatible (e.g. a raw Rock Band PS3 PKG without a converted chart).`
    )
  }
  const singleSng = sngs.length === 1
  for (const sng of sngs) {
    const baseName = singleSng
      ? tpl.name
      : sanitize((sng.split(/[\\/]/).pop() || 'song.sng').replace(/\.sng$/i, ''))
    const dest = uniqueFile(songsDir, baseName, '.sng')
    await fsp.copyFile(sng, dest)
    installed.push(dest)
  }
  invalidateLibraryIndex()
  invalidateOwnedIndex()
  return { installedPaths: installed }
}
