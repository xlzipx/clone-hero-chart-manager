// Správce knihovny Songs: procházení, vytváření složek, přejmenování, mazání
// (do koše), přesun a kopírování. Vše je bezpečně omezené na songsDir.

import { nativeImage, shell } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { cp, readdir, rm } from 'fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { getConfig, setConfig } from './config'
import { closeAudioUnder } from './localaudio'
import { EXT_PREFIX, extraFolders, folderId, foldPath, isRootAbs, resolveRel, songsRoot, toRel, type ExtraFolder } from './roots'
import { portableName } from '../../shared/foldertemplate'
import { readAlbumArt, readSongInfo, readSongMeta, writeSongMeta } from './songmeta'
import {
  addSongsToPlaylist,
  deletePlaylist,
  getPlaylistSongs,
  getPlaylistTracks,
  invalidateLibraryIndex,
  listPlaylists,
  notesStat,
  removeSongsFromPlaylist,
  renamePlaylist,
  songHashCached
} from './playlists'
import { songKey } from '../../shared/songid'
import { invalidateOwnedIndex } from './library'
import { findDuplicates } from './duplicates'
import { extractSng, isSngFile } from './sngextract'
import type {
  ExistingMatch,
  DupGroup,
  LibSongInfo,
  PlayerTrack,
  PlaylistAddResult,
  PlaylistInfo,
  PlaylistSong,
  SongDetail,
  SongMeta,
  LibProblem,
  LibEntry as LibEntryFull
} from '../../shared/types'

const SONG_MARKERS = ['song.ini', 'notes.chart', 'notes.mid']

export interface LibEntry {
  name: string
  type: 'dir' | 'file'
  isSong: boolean
  problem?: LibProblem
}

/**
 * Smazání složky / souboru z knihovny podle Nastavení: do koše (výchozí, jde
 * obnovit), nebo rovnou natrvalo. Všechna mazání v knihovně jdou tudy.
 */
async function removePath(abs: string): Promise<void> {
  // Otevřený zvukový soubor (přehrávač / náhled) by smazání složky zablokoval.
  closeAudioUnder(abs)
  if (getConfig().deleteMode === 'permanent') {
    // Windows uvolní právě zavřené soubory s malým zpožděním → pár pokusů.
    await rm(abs, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    return
  }
  for (let i = 0; ; i++) {
    try {
      await shell.trashItem(abs)
      return
    } catch (err) {
      if (i >= 4) throw err
      await new Promise((r) => setTimeout(r, 150))
    }
  }
}

function rootDir(): string {
  return songsRoot()
}

/** Bezpečně převede relativní cestu na absolutní uvnitř Songs nebo další
 *  složky (předpona `::id`, viz roots.ts). */
function safeAbs(rel: string): string {
  return resolveRel(rel).abs
}

function sanitizeName(name: string): string {
  const clean = portableName(name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim())
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
    else if (isRootAbs(abs)) throw new Error('Folder not found. Is the drive connected?')
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
      return { rel: toRel(abs), title, artist }
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
  if (isRootAbs(src)) throw new Error('Cannot rename a library root folder')
  closeAudioUnder(src)
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
  if (isRootAbs(abs)) throw new Error('Cannot delete a library root folder')
  await removePath(abs)
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
    await removePath(broken)
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

/** Problém složky z jejího výpisu (stejná pravidla jako `inspectDir`). */
function problemFromNames(names: string[]): { isSong: boolean; problem?: LibProblem } {
  const lower = names.map((x) => x.toLowerCase())
  const isSong = SONG_MARKERS.some((m) => lower.includes(m))
  const hasChart = lower.includes('notes.chart') || lower.includes('notes.mid')
  const hasAudio = names.some((n) => AUDIO_EXT.test(n))
  const hasIni = lower.includes('song.ini')
  if (!hasChart && hasAudio) return { isSong, problem: 'chart' }
  if (hasChart && !hasAudio) return { isSong, problem: 'audio' }
  if (!hasChart && !hasAudio && hasIni) return { isSong, problem: 'both' }
  return { isSong }
}

/**
 * Rozbité písně ve složce `rel` a ve VŠECH jejích podsložkách (filtr „Broken
 * songs"). `name` ve výsledku je cesta relativně k `rel` (např. „Pack/Píseň"),
 * takže je unikátní i napříč podsložkami. Do zdravé písně se nezanořuje.
 */
export async function libFindBroken(rel: string): Promise<LibEntryFull[]> {
  const base = safeAbs(rel)
  const out: LibEntryFull[] = []
  const walk = async (abs: string, depth: number): Promise<void> => {
    if (depth > 12) return
    let ents
    try {
      ents = await readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    const subdirs = ents.filter((e) => e.isDirectory() && !isJunkEntry(e.name))
    await Promise.all(
      subdirs.map(async (d) => {
        const full = join(abs, d.name)
        let names: string[] = []
        try {
          names = await readdir(full)
        } catch {
          return
        }
        const info = problemFromNames(names)
        if (info.problem) {
          try {
            const st = statSync(full)
            out.push({
              name: relative(base, full).split(sep).join('/'),
              type: 'dir',
              ...info,
              size: st.size,
              mtimeMs: st.mtimeMs,
              birthtimeMs: st.birthtimeMs
            })
          } catch {
            /* mezitím smazáno */
          }
        }
        // Zdravá píseň = konec větve; složky a rozbité písně procházej dál.
        if (!info.isSong || info.problem) await walk(full, depth + 1)
      })
    )
  }
  await walk(base, 0)
  out.sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  return out
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
  await removePath(src)
  invalidateLibraryIndex()
  invalidateOwnedIndex()
  return toRel(out)
}

export async function libMove(srcRelItem: string, destRelDir: string): Promise<void> {
  const src = safeAbs(srcRelItem)
  if (isRootAbs(src)) throw new Error('Cannot move a library root folder')
  closeAudioUnder(src)
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
    // Jiný disk (typicky archiv na externím disku): asynchronně, ať okno
    // během kopírování velkých složek nezamrzne.
    await cp(src, dest, { recursive: true })
    await removePath(src)
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
    closeAudioUnder(src)
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

export async function libCopy(srcRelItem: string, destRelDir: string): Promise<void> {
  const src = safeAbs(srcRelItem)
  const destDir = safeAbs(destRelDir)
  const dest = uniqueDest(destDir, basename(src))
  if (resolve(dest).startsWith(resolve(src) + sep)) {
    throw new Error('Cannot copy a folder into itself')
  }
  // Asynchronně — kopie z pomalého externího disku by jinak zamrazila okno.
  await cp(src, dest, { recursive: true })
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
  // Clone Hero hledá písně setlistu jen ve složce Songs.
  if (relItems.some((r) => r.startsWith(EXT_PREFIX))) {
    return Promise.reject(new Error('Setlists can only contain songs from your Songs folder. Copy the songs there first.'))
  }
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

// ── Další složky (archivy chartů mimo Songs, issue #8) ─────────────────────
export function libExtraFolders(): ExtraFolder[] {
  return extraFolders()
}

/** Přidá složku do seznamu. Nesmí to být Songs, nic uvnitř Songs ani složka,
 *  která Songs obsahuje (stejné charty by se ukazovaly dvakrát). */
export function libAddExtraFolder(absPath: string): ExtraFolder {
  const abs = resolve(absPath)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error('Folder not found')
  const lc = foldPath
  const songs = lc(songsRoot())
  const a = lc(abs)
  if (a === songs) throw new Error('This is already your Songs folder')
  if (a.startsWith(songs + sep)) throw new Error('This folder is inside your Songs folder, open it under Songs instead')
  if (songs.startsWith(a.endsWith(sep) ? a : a + sep)) throw new Error('This folder contains your Songs folder, pick a different one')
  const cur = getConfig().extraFolders ?? []
  if (cur.some((p) => folderId(p) === folderId(abs))) throw new Error('This folder is already in the list')
  setConfig({ extraFolders: [...cur, abs] })
  return extraFolders().find((f) => f.id === folderId(abs))!
}

/** Odebere složku ze seznamu (soubory zůstanou, jen se přestane zobrazovat). */
export function libRemoveExtraFolder(id: string): void {
  setConfig({ extraFolders: (getConfig().extraFolders ?? []).filter((p) => folderId(p) !== id) })
}

// ── Ochrana proti duplicitám při kopírování / přesunu ──────────────────────
/**
 * Které z kopírovaných / přesouvaných písní už v cílové složce jsou (jen přímo
 * v ní, ne v podsložkách). `identical` = stejný soubor s notami (MD5, stejně
 * jako hledání duplicit), `same-song` = stejný interpret + název, jiný chart.
 * Hash se počítá jen u kandidátů (stejná velikost not nebo stejný název), ať
 * je kontrola rychlá i u složky s tisíci písněmi.
 */
export async function libFindExisting(srcRels: string[], destRelDir: string): Promise<ExistingMatch[]> {
  const dest = safeAbs(destRelDir)
  if (!existsSync(dest)) return []
  const keyOf = async (abs: string): Promise<string> => {
    const meta = await readSongMeta(abs).catch(() => null)
    const name = basename(abs)
    const d = name.indexOf(' - ')
    const artist = meta?.artist || (d > 0 ? name.slice(0, d) : '')
    const title = meta?.name || (d > 0 ? name.slice(d + 3) : name)
    return songKey(stripTagsLite(artist), stripTagsLite(title))
  }
  const srcs: { rel: string; abs: string; name: string; key: string; size: number | null }[] = []
  for (const rel of srcRels) {
    const abs = safeAbs(rel)
    if (dirname(abs) === dest || !inspectDir(abs).isSong) continue // stejná složka / není píseň
    srcs.push({ rel, abs, name: basename(abs), key: await keyOf(abs), size: (await notesStat(abs))?.size ?? null })
  }
  if (!srcs.length) return []
  const keys = new Set(srcs.map((s) => s.key))
  const sizes = new Set(srcs.map((s) => s.size).filter((x): x is number => x !== null))
  const byKey = new Map<string, string>()
  const byHash = new Map<string, string>()
  let names: string[] = []
  try {
    names = readdirSync(dest)
  } catch {
    return []
  }
  // Souběžně po dávkách — u cílové složky s tisíci písněmi by čtení jedna po
  // druhé trvalo vteřiny.
  const check = async (n: string): Promise<void> => {
    const abs = join(dest, n)
    try {
      if (!statSync(abs).isDirectory() || !inspectDir(abs).isSong) return
    } catch {
      return
    }
    const [k, st] = await Promise.all([keyOf(abs), notesStat(abs)])
    if (keys.has(k) && !byKey.has(k)) byKey.set(k, n)
    if (keys.has(k) || (st && sizes.has(st.size))) {
      const h = await songHashCached(abs)
      if (h && !byHash.has(h)) byHash.set(h, n)
    }
  }
  for (let i = 0; i < names.length; i += 48) await Promise.all(names.slice(i, i + 48).map(check))
  const out: ExistingMatch[] = []
  for (const s of srcs) {
    const h = byHash.size ? await songHashCached(s.abs) : null
    if (h && byHash.has(h)) out.push({ rel: s.rel, name: s.name, match: byHash.get(h)!, kind: 'identical' })
    else if (byKey.has(s.key)) out.push({ rel: s.rel, name: s.name, match: byKey.get(s.key)!, kind: 'same-song' })
  }
  return out
}

function stripTagsLite(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}
