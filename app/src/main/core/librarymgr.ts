// Správce knihovny Songs: procházení, vytváření složek, přejmenování, mazání
// (do koše), přesun a kopírování. Vše je bezpečně omezené na songsDir.

import { shell } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { readdir } from 'fs/promises'
import { basename, extname, join, resolve, sep } from 'path'
import { getConfig } from './config'
import { readAlbumArt, readSongInfo, readSongMeta, writeSongMeta } from './songmeta'
import {
  addSongsToPlaylist,
  deletePlaylist,
  getPlaylistSongs,
  invalidateLibraryIndex,
  listPlaylists,
  removeSongsFromPlaylist,
  renamePlaylist
} from './playlists'
import { invalidateOwnedIndex } from './library'
import { findDuplicates } from './duplicates'
import type {
  DupGroup,
  LibSongInfo,
  PlaylistAddResult,
  PlaylistInfo,
  PlaylistSong,
  SongDetail,
  SongMeta
} from '../../shared/types'

const SONG_MARKERS = ['song.ini', 'notes.chart', 'notes.mid']

export interface LibEntry {
  name: string
  type: 'dir' | 'file'
  isSong: boolean
}

function rootDir(): string {
  return resolve(getConfig().songsDir)
}

/** Bezpečně převede relativní cestu na absolutní uvnitř songsDir. */
function safeAbs(rel: string): string {
  const base = rootDir()
  const abs = resolve(base, rel || '.')
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error('Path is outside the Songs library')
  }
  return abs
}

function sanitizeName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()
  if (!clean || clean === '.' || clean === '..') throw new Error('Invalid name')
  return clean
}

function isSongDir(abs: string): boolean {
  try {
    const e = readdirSync(abs).map((x) => x.toLowerCase())
    return SONG_MARKERS.some((m) => e.includes(m))
  } catch {
    return false
  }
}

/** Unikátní cílová cesta (přidá " (2)" atd. před příponu u souboru). */
function uniqueDest(dir: string, name: string): string {
  let dest = join(dir, name)
  if (!existsSync(dest)) return dest
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let i = 2
  while (existsSync(join(dir, `${stem} (${i})${ext}`))) i++
  return join(dir, `${stem} (${i})${ext}`)
}

export function libList(rel: string): { path: string; entries: LibEntry[] } {
  const abs = safeAbs(rel)
  // Kořen vytvoříme (první spuštění), ale neexistující PODcesty ne — listování
  // je čtecí operace a nemá zakládat adresáře podle libovolného vstupu.
  if (!existsSync(abs)) {
    if (abs === rootDir()) mkdirSync(abs, { recursive: true })
    else return { path: rel, entries: [] }
  }
  let names: string[] = []
  try {
    names = readdirSync(abs)
  } catch {
    /* ignore */
  }
  const entries: LibEntry[] = []
  for (const name of names) {
    const full = join(abs, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) entries.push({ name, type: 'dir', isSong: isSongDir(full) })
    else if (st.isFile()) entries.push({ name, type: 'file', isSong: false })
  }
  entries.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name, 'cs') : a.type === 'dir' ? -1 : 1
  )
  return { path: rel, entries }
}

// Rekurzivně spočítá písničky (složky s markerem) uvnitř — do samotné písně už
// nelezeme (její soubory nejsou další písně). Async (fs/promises), ať to u velké
// knihovny nezablokuje main proces.
async function countSongsIn(abs: string, depth = 0): Promise<number> {
  if (depth > 10) return 0
  let ents
  try {
    ents = await readdir(abs, { withFileTypes: true })
  } catch {
    return 0
  }
  if (ents.some((e) => e.isFile() && SONG_MARKERS.includes(e.name.toLowerCase()))) return 1
  let total = 0
  for (const e of ents) {
    if (e.isFile()) {
      // Volné .sng (zabalený CH/Encore chart) je samostatná píseň.
      if (e.name.toLowerCase().endsWith('.sng')) total += 1
    } else if (e.isDirectory()) {
      total += await countSongsIn(join(abs, e.name), depth + 1)
    }
  }
  return total
}

/** Pro každou PODsložku dané složky vrátí počet písní uvnitř (song složka = 1).
 *  Počítá se na pozadí — Library manager doplní odznaky, jakmile dorazí. */
export async function libFolderCounts(rel: string): Promise<Record<string, number>> {
  const abs = safeAbs(rel)
  const out: Record<string, number> = {}
  let ents
  try {
    ents = await readdir(abs, { withFileTypes: true })
  } catch {
    return out
  }
  await Promise.all(
    ents
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        out[e.name] = await countSongsIn(join(abs, e.name))
      })
  )
  return out
}

export function libCreateFolder(rel: string, name: string): void {
  const abs = join(safeAbs(rel), sanitizeName(name))
  if (existsSync(abs)) throw new Error('A folder with that name already exists')
  mkdirSync(abs, { recursive: false })
}

export function libRename(relItem: string, newName: string): void {
  const src = safeAbs(relItem)
  // Cíl skládáme z rodiče relItem + nový (sanitizovaný) název a CELÝ ho ověříme
  // přes safeAbs (jinak by rodičovská část nebyla kontrolovaná na traversal).
  const parentRel = relItem.split(/[\\/]/).slice(0, -1).join('/')
  const dest = safeAbs(join(parentRel, sanitizeName(newName)))
  if (existsSync(dest)) throw new Error('An item with that name already exists')
  renameSync(src, dest)
  invalidateLibraryIndex()
  invalidateOwnedIndex()
}

export async function libTrash(relItem: string): Promise<void> {
  const abs = safeAbs(relItem)
  if (abs === rootDir()) throw new Error('Cannot delete the Songs root')
  await shell.trashItem(abs)
  invalidateLibraryIndex()
  invalidateOwnedIndex()
}

export function libMove(srcRelItem: string, destRelDir: string): void {
  const src = safeAbs(srcRelItem)
  const destDir = safeAbs(destRelDir)
  const dest = uniqueDest(destDir, basename(src))
  if (resolve(dest).startsWith(resolve(src) + sep)) {
    throw new Error('Cannot move a folder into itself')
  }
  try {
    renameSync(src, dest)
  } catch (err) {
    // Fallback kopie+koš JEN u skutečného cross-device (EXDEV). Přechodné chyby
    // (EBUSY/EPERM — píseň otevřená ve hře) musí selhat čistě, ne polovičatě.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    cpSync(src, dest, { recursive: true })
    void shell.trashItem(src)
  }
  invalidateLibraryIndex()
  invalidateOwnedIndex()
}

/**
 * Přesune položky knihovny do složky MIMO knihovnu — „karanténa" duplicit místo
 * koše (návrh z Redditu: `shell.trashItem` nefunguje ve Wine/VM na Linuxu).
 * Cíl vybírá uživatel systémovým dialogem; sem přijde absolutní cesta.
 */
export function libMoveOut(relItems: string[], destAbsDir: string): void {
  const destDir = resolve(destAbsDir)
  let st
  try {
    st = statSync(destDir)
  } catch {
    throw new Error('Destination folder does not exist')
  }
  if (!st.isDirectory()) throw new Error('Destination is not a folder')
  const base = rootDir()
  // Uvnitř knihovny karanténa být nesmí — CH by ji při dalším skenu zase načetl.
  // Porovnání case-INSENSITIVE: NTFS nerozlišuje velikost, takže „g:\…\songs\q"
  // je reálně uvnitř base „G:\…\Songs", i když se řetězce liší velikostí písmen.
  const baseLC = base.toLowerCase()
  const destLC = destDir.toLowerCase()
  if (destLC === baseLC || destLC.startsWith(baseLC + sep)) {
    throw new Error('Pick a folder outside the Songs library, otherwise Clone Hero will scan the duplicates again')
  }
  for (const rel of relItems) {
    const src = safeAbs(rel)
    if (src === base) throw new Error('Cannot move the Songs root')
    const dest = uniqueDest(destDir, basename(src))
    try {
      renameSync(src, dest)
    } catch (err) {
      // Cross-device (jiný disk) → kopie + smazání originálu. Záměrně fs.rm,
      // NE koš — celá pointa téhle funkce je fungovat i bez Windows shellu.
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      cpSync(src, dest, { recursive: true })
      try {
        rmSync(src, { recursive: true, force: true })
      } catch {
        // Kopie prošla, ale originál nejde smazat (např. otevřený ve hře) —
        // radši srozumitelně, ať uživatel neskončí s tichým duplikátem.
        throw new Error(
          `Copied "${basename(src)}" to the destination, but could not remove the original (is it open in the game?). Remove it manually.`
        )
      }
    }
  }
  invalidateLibraryIndex()
  invalidateOwnedIndex()
}

export function libCopy(srcRelItem: string, destRelDir: string): void {
  const src = safeAbs(srcRelItem)
  const destDir = safeAbs(destRelDir)
  const dest = uniqueDest(destDir, basename(src))
  cpSync(src, dest, { recursive: true })
  invalidateLibraryIndex()
  invalidateOwnedIndex()
}

export function libOpen(rel: string): void {
  void shell.openPath(safeAbs(rel))
}

export function libReveal(relItem: string): void {
  shell.showItemInFolder(safeAbs(relItem))
}

// ── Metadata (song.ini) ───────────────────────────────────────────────
export function libReadMeta(relItem: string): Promise<SongMeta> {
  return readSongMeta(safeAbs(relItem))
}
export function libWriteMeta(relItem: string, fields: SongMeta): Promise<void> {
  return writeSongMeta(safeAbs(relItem), fields)
}
/** Detailní info pro dávku písní (bohaté řádky). Vrátí jen ty, co mají song.ini. */
export async function libSongInfo(rels: string[]): Promise<LibSongInfo[]> {
  const out: LibSongInfo[] = []
  for (const rel of rels) {
    try {
      const info = await readSongInfo(safeAbs(rel))
      if (info) out.push({ rel, ...info })
    } catch {
      /* přeskoč neplatné */
    }
  }
  return out
}
/** Detail otevřené písně: metadata + obal alba (data URI). */
export async function libSongDetail(rel: string): Promise<SongDetail> {
  const abs = safeAbs(rel)
  const info = await readSongInfo(abs)
  const albumArt = await readAlbumArt(abs)
  return { info: info ? { rel, ...info } : null, albumArt }
}

// ── Playlisty (.setlist) ──────────────────────────────────────────────
export function libListPlaylists(): Promise<PlaylistInfo[]> {
  return listPlaylists()
}
export function libAddToPlaylist(
  name: string,
  relItems: string[]
): Promise<PlaylistAddResult> {
  return addSongsToPlaylist(
    name,
    relItems.map((r) => safeAbs(r))
  )
}
export function libDeletePlaylist(name: string): Promise<void> {
  return deletePlaylist(name)
}
export function libRenamePlaylist(oldName: string, newName: string): Promise<void> {
  return renamePlaylist(oldName, newName)
}
export function libPlaylistSongs(name: string): Promise<PlaylistSong[]> {
  return getPlaylistSongs(name)
}
export function libRemoveFromPlaylist(name: string, hashes: string[]): Promise<void> {
  return removeSongsFromPlaylist(name, hashes)
}

// ── Duplicity ─────────────────────────────────────────────────────────
/** `scope` = relativní podsložky Songs; prázdné/neuvedené = celá knihovna. */
export function libFindDuplicates(scope?: string[]): Promise<DupGroup[]> {
  return findDuplicates(scope)
}
