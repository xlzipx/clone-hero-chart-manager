// Instalace stažených/zkonvertovaných písní do knihovny Clone Hero (Songs).

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync
} from 'fs'
import { basename, join } from 'path'
import { getConfig } from './config'
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

/** Normalizovaný klíč skladby: jen malá písmena a číslice, artist|title. */
function normKey(artist: string, title: string): string {
  const n = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${n(artist)}|${n(title)}`
}

/** Přečte artist/title ze `song.ini` (rychlé, malý soubor). */
function readIniMeta(folder: string): { artist: string; title: string } | null {
  try {
    const ini = join(folder, 'song.ini')
    if (!existsSync(ini)) return null
    const txt = readFileSync(ini, 'utf-8')
    const name = /^\s*name\s*=\s*(.+)$/im.exec(txt)?.[1]?.trim()
    const artist = /^\s*artist\s*=\s*(.+)$/im.exec(txt)?.[1]?.trim()
    if (!name && !artist) return null
    return { artist: artist ?? '', title: name ?? '' }
  } catch {
    return null
  }
}

/** "Artist - Title" → rozdělené; jinak title = celý název. */
function splitName(name: string): { artist: string; title: string } {
  const dash = name.indexOf(' - ')
  if (dash > 0) return { artist: name.slice(0, dash).trim(), title: name.slice(dash + 3).trim() }
  return { artist: '', title: name.trim() }
}

/**
 * Normalizované klíče (artist|title) všech písní v knihovně Songs — z názvů složek
 * a ze `song.ini` (rekurzivně, i podsložky) + volných .sng. Slouží jako NÁPOVĚDA
 * „tohle už asi máš" ve výsledcích hledání. Match není 100% (různé zápisy názvů).
 */
export function ownedSongKeys(): string[] {
  const songsDir = getConfig().songsDir
  if (!existsSync(songsDir)) return []
  const keys = new Set<string>()
  for (const folder of findSongFolders(songsDir)) {
    const meta = readIniMeta(folder) ?? splitName(basename(folder))
    if (!meta.title) continue
    keys.add(normKey(meta.artist, meta.title))
  }
  for (const sng of findSngFiles(songsDir)) {
    const { artist, title } = splitName(basename(sng).replace(/\.sng$/i, ''))
    if (title) keys.add(normKey(artist, title))
  }
  return [...keys]
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
export function install(sourceRoot: string, song: SongResult, subfolder?: string): InstallResult {
  const baseSongsDir = getConfig().songsDir
  // Sanitizace případné podsložky (může obsahovat i vnořenou cestu od uživatele).
  // POZOR: prázdné segmenty musí pryč PŘED sanitizací — `sanitize('')` vrací
  // 'Unknown', takže Root ('') by jinak vytvořil složku „Unknown".
  const cleanSub = (subfolder ?? '')
    .split(/[\\/]/)
    .filter(Boolean)
    .map((p) => sanitize(p))
    .filter(Boolean)
    .join('\\')
  const songsDir = cleanSub ? join(baseSongsDir, cleanSub) : baseSongsDir
  if (!existsSync(songsDir)) mkdirSync(songsDir, { recursive: true })

  const installed: string[] = []
  const folders = findSongFolders(sourceRoot)

  if (folders.length > 0) {
    const single = folders.length === 1
    for (const folder of folders) {
      // U jediné písně použij metadata z RhythmVerse; u packu zachovej původní názvy.
      const folderName = single
        ? sanitize(`${song.artist} - ${song.title}`)
        : sanitize(folder.split(/[\\/]/).pop() || `${song.artist} - ${song.title}`)
      const dest = uniqueDir(join(songsDir, folderName))
      cpSync(folder, dest, { recursive: true })
      installed.push(dest)
    }
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
      ? sanitize(`${song.artist} - ${song.title}`)
      : sanitize((sng.split(/[\\/]/).pop() || 'song.sng').replace(/\.sng$/i, ''))
    const dest = uniqueFile(songsDir, baseName, '.sng')
    copyFileSync(sng, dest)
    installed.push(dest)
  }
  return { installedPaths: installed }
}
