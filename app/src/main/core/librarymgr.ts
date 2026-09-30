// Správce knihovny Songs: procházení, vytváření složek, přejmenování, mazání
// (do koše), přesun a kopírování. Vše je bezpečně omezené na songsDir.

import { nativeImage, shell } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { readdir } from 'fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { getConfig } from './config'
import { readAlbumArt, readSongInfo, readSongMeta, writeSongMeta } from './songmeta'
import {
  addSongsToPlaylist,
  deletePlaylist,
  getPlaylistSongs,
  getPlaylistTracks,
  invalidateLibraryIndex,
  listPlaylists,
  removeSongsFromPlaylist,
  renamePlaylist
} from './playlists'
import { invalidateOwnedIndex } from './library'
import { findDuplicates } from './duplicates'
import { extractSng, isSngFile } from './sngextract'
import type {
  DupGroup,
  LibSongInfo,
  PlayerTrack,
  PlaylistAddResult,
  PlaylistInfo,
  PlaylistSong,
  SongDetail,
  SongMeta,
  LibProblem
} from '../../shared/types'

const SONG_MARKERS = ['song.ini', 'notes.chart', 'notes.mid']

export interface LibEntry {
  name: string
  type: 'dir' | 'file'
  isSong: boolean
  problem?: LibProblem
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

// Zvukové stopy chartu. Složka, která je má, ale chybí jí soubor s notami, je
// nejspíš nedokončený převod (typicky RB → CH, kde se zkopírovalo jen audio).
const AUDIO_EXT = /\.(ogg|opus|mp3|wav|flac|m4a|mogg)$/i

/** Je složka píseň? A pokud ne, vypadá jako rozbitá píseň (audio bez chartu)? */
function inspectDir(abs: string): { isSong: boolean; problem?: LibProblem } {
  try {
    const names = readdirSync(abs)
    const lower = names.map((x) => x.toLowerCase())
    const isSong = SONG_MARKERS.some((m) => lower.includes(m))
    const hasChart = lower.includes('notes.chart') || lower.includes('notes.mid')
    const hasAudio = names.some((n) => AUDIO_EXT.test(n))
    const hasIni = lower.includes('song.ini')
    // Složka „vypadá jako píseň" (má aspoň jednu její část), ale něco chybí.
    let problem: LibProblem | undefined
    if (!hasChart && hasAudio) problem = 'chart'
    else if (hasChart && !hasAudio) problem = 'audio'
    else if (!hasChart && !hasAudio && hasIni) problem = 'both'
    return problem ? { isSong, problem } : { isSong }
  } catch {
    return { isSong: false }
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

// Systémové smetí, které OS zakládá do složek a v knihovně nemá co dělat:
// macOS `.DS_Store` + AppleDouble `._*`, Windows `Thumbs.db` / `desktop.ini`.
const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])
function isJunkEntry(name: string): boolean {
  const lower = name.toLowerCase()
  return JUNK_NAMES.has(lower) || lower.startsWith('._')
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
    if (isJunkEntry(name)) continue // .DS_Store, Thumbs.db, ._* … nezobrazovat
    const full = join(abs, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    const common = { size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs }
    if (st.isDirectory()) entries.push({ name, type: 'dir', ...inspectDir(full), ...common })
    else if (st.isFile()) entries.push({ name, type: 'file', isSong: false, ...common })
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

/** Rekurzivně posbírá absolutní cesty ke VŠEM song složkám pod `abs`. Do samotné
 *  písně už neleze (její soubory nejsou další písně) — stejná logika jako
 *  `countSongsIn`. Volné `.sng` se přeskakují (přehrávač míchá stopy ze složky). */
async function collectSongFolders(abs: string, out: string[], depth = 0): Promise<void> {
  if (depth > 10) return
  let ents
  try {
    ents = await readdir(abs, { withFileTypes: true })
  } catch {
    return
  }
  if (ents.some((e) => e.isFile() && SONG_MARKERS.includes(e.name.toLowerCase()))) {
    out.push(abs)
    return
  }
  for (const e of ents) {
    if (e.isDirectory()) await collectSongFolders(join(abs, e.name), out, depth + 1)
  }
}

/** Fronta pro přehrávač: všechny písně pod danou složkou (rekurzivně) i s názvem
 *  a interpretem. Řazeno interpret → název, ať playlist dává smysl. */
export async function libListSongsUnder(rel: string): Promise<PlayerTrack[]> {
  const absRoot = safeAbs(rel)
  const folders: string[] = []
  await collectSongFolders(absRoot, folders)
  const root = rootDir()
  const tracks = await Promise.all(
    folders.map(async (abs) => {
      let title = basename(abs)
      let artist = ''
      try {
        const info = await readSongInfo(abs)
        if (info) {
          if (info.title) title = info.title
          artist = info.artist ?? ''
        }
      } catch {
        /* neplatná píseň → aspoň název složky */
      }
      return { rel: relative(root, abs), title, artist }
    })
  )
  tracks.sort(
    (a, b) => a.artist.localeCompare(b.artist, 'cs') || a.title.localeCompare(b.title, 'cs')
  )
  return tracks
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

/**
 * „Fix it": po stažení náhrady rozbité písně pošle rozbitou složku do koše.
 * Když nová složka skončila vedle ní jen s „ (2)" kvůli kolizi názvů, vrátí jí
 * původní název. Složku, kterou uživatel mezitím opravil sám (už nic
 * nechybí), nechá být. Vrací relativní cestu nové složky.
 */
export async function libReplaceBroken(brokenRel: string, installAbs: string): Promise<string> {
  const broken = safeAbs(brokenRel)
  if (broken === rootDir()) throw new Error('Cannot replace the Songs root')
  let inst = safeAbs(relative(rootDir(), resolve(installAbs)))
  if (existsSync(broken) && inspectDir(broken).problem) {
    await shell.trashItem(broken)
    const name = basename(broken)
    const instName = basename(inst)
    if (
      dirname(inst) === dirname(broken) &&
      !existsSync(broken) &&
      instName.toLowerCase().startsWith(`${name.toLowerCase()} (`)
    ) {
      renameSync(inst, broken)
      inst = broken
    }
  }
  invalidateLibraryIndex()
  invalidateOwnedIndex()
  return relative(rootDir(), inst).split(sep).join('/')
}

/**
 * Rozbalí .sng z knihovny do normální složky písně vedle něj (stejně jako při
 * stahování) a .sng pošle do koše. Vrací relativní cestu nové složky.
 */
export async function libUnpackSng(relItem: string): Promise<string> {
  const src = safeAbs(relItem)
  if (!/\.sng$/i.test(src) || !statSync(src).isFile() || !(await isSngFile(src))) {
    throw new Error('Not a .sng file')
  }
  const parent = dirname(src)
  // Volný název vedle .sng (např. když už složka stejného jména existuje).
  const name = basename(uniqueDest(parent, basename(src).replace(/\.sng$/i, '')))
  const out = await extractSng(src, parent, name)
  await shell.trashItem(src)
  invalidateLibraryIndex()
  invalidateOwnedIndex()
  return relative(rootDir(), out).split(sep).join('/')
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
// Miniatury obalů pro karty v Library. Klíč = cesta + mtime obalu, takže
// změněný obal se přegeneruje a nezměněný se čte z paměti.
const thumbCache = new Map<string, string | null>()
const ART_NAMES = ['album.png', 'album.jpg', 'album.jpeg', 'album.webp']

async function albumThumb(folderAbs: string, size = 112): Promise<string | null> {
  for (const n of ART_NAMES) {
    const p = join(folderAbs, n)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    const key = `${p}|${st.mtimeMs}|${size}`
    const hit = thumbCache.get(key)
    if (hit !== undefined) return hit
    let out: string | null = null
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) {
        const small = img.resize({ width: size, height: size, quality: 'good' })
        out = `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`
      }
    } catch {
      out = null
    }
    thumbCache.set(key, out)
    // Dekódování obrázku je synchronní — mezi obaly pusť event loop dál.
    await new Promise((r) => setImmediate(r))
    return out
  }
  return null
}

/** Malé náhledy obalů (data URI JPEG ~112 px) pro dávku písní; null = obal není. */
export async function libAlbumThumbs(rels: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const rel of rels) {
    try {
      out[rel] = await albumThumb(safeAbs(rel))
    } catch {
      out[rel] = null
    }
  }
  return out
}

/** Větší obaly (~320 px) pro stoh vybraných písní v pravém panelu. */
export async function libAlbumCovers(rels: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const rel of rels) {
    try {
      out[rel] = await albumThumb(safeAbs(rel), 320)
    } catch {
      out[rel] = null
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
/** Písně setlistu jako fronta pro přehrávač (jen nalezené, s cestou ke složce). */
export function libPlaylistTracks(name: string): Promise<PlayerTrack[]> {
  return getPlaylistTracks(name)
}
export function libRemoveFromPlaylist(name: string, hashes: string[]): Promise<void> {
  return removeSongsFromPlaylist(name, hashes)
}

// ── Duplicity ─────────────────────────────────────────────────────────
/** `scope` = relativní podsložky Songs; prázdné/neuvedené = celá knihovna. */
export function libFindDuplicates(scope?: string[]): Promise<DupGroup[]> {
  return findDuplicates(scope)
}
