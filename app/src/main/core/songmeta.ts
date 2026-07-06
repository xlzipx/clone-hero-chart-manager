// Čtení a zápis metadat písně (`song.ini`). Zachovává neznámé klíče i strukturu
// souboru — mění jen zadaná pole v sekci [song].

import { promises as fsp } from 'fs'
import { join } from 'path'
import type { InstrumentDifficulties, SongMeta } from '../../shared/types'

/**
 * Odstraní Clone Hero / Unity rich-text tagy pro ZOBRAZENÍ v UI
 * (`<color=orange>Neversoft</color>`, <b>, <i>, <size=...>…). Hra je vykresluje
 * barevně, my bychom ukazovali syrové značky. V song.ini zůstávají netknuté —
 * stripovat jen pro display, NE při editaci metadat.
 */
export function stripRichTags(s: string): string {
  return s.replace(/<\/?(?:color|b|i|u|s|size|material|quad|sprite|alpha|mark|noparse)\b[^>]*>/gi, '').trim()
}

/** Pole, která editor nabízí (a v tomto pořadí). */
export const META_FIELDS: (keyof SongMeta)[] = [
  'name',
  'artist',
  'album',
  'genre',
  'year',
  'charter'
]

/** Přečte metadata ze `song.ini` ve složce písně (abs cesta). Chybí-li, vrátí prázdné. */
export async function readSongMeta(folderAbs: string): Promise<SongMeta> {
  let txt: string
  try {
    txt = await fsp.readFile(join(folderAbs, 'song.ini'), 'utf-8')
  } catch {
    return {}
  }
  const meta: SongMeta = {}
  for (const f of META_FIELDS) {
    const m = new RegExp(`^\\s*${f}\\s*=\\s*(.*)$`, 'im').exec(txt)
    if (m) meta[f] = m[1].trim()
  }
  return meta
}

/**
 * Zapíše zadaná pole do `song.ini`. Existující klíče přepíše na místě (zachová
 * pořadí i ostatní klíče), chybějící přidá pod hlavičku `[Song]`. Když song.ini
 * neexistuje, vytvoří minimální.
 */
export async function writeSongMeta(folderAbs: string, fields: SongMeta): Promise<void> {
  const iniPath = join(folderAbs, 'song.ini')
  let txt: string
  try {
    txt = await fsp.readFile(iniPath, 'utf-8')
  } catch {
    txt = '[Song]\n'
  }
  const eol = txt.includes('\r\n') ? '\r\n' : '\n'
  const lines = txt.split(/\r?\n/)

  // Zajisti sekci [song] (case-insensitive).
  let headerIdx = lines.findIndex((l) => /^\s*\[song\]\s*$/i.test(l))
  if (headerIdx === -1) {
    lines.unshift('[Song]')
    headerIdx = 0
  }

  for (const key of META_FIELDS) {
    const raw = fields[key]
    if (raw === undefined) continue
    // Sanitizace: hodnota s \n by rozbila strukturu INI (vložila by nový řádek).
    const val = String(raw).replace(/[\r\n]+/g, ' ').trim()
    const re = new RegExp(`^(\\s*${key}\\s*=).*$`, 'i')
    const idx = lines.findIndex((l) => re.test(l))
    if (idx >= 0) {
      // POZOR: replacement musí být funkce — v řetězci by se `$` uvnitř hodnoty
      // interpretoval jako replacement pattern ($1, $&, …) a hodnotu zkorumpoval.
      lines[idx] = lines[idx].replace(re, (_m, g1: string) => `${g1} ${val}`)
    } else {
      // Vlož hned za hlavičku [Song].
      lines.splice(headerIdx + 1, 0, `${key} = ${val}`)
    }
  }

  // Atomický zápis (tmp + rename), ať pád uprostřed zápisu nezanechá useknutý soubor.
  const tmp = iniPath + '.tmp'
  await fsp.writeFile(tmp, lines.join(eol), 'utf-8')
  await fsp.rename(tmp, iniPath)
}

/** Obal alba jako data URI (album.png/jpg/jpeg/webp), nebo null. */
export async function readAlbumArt(folderAbs: string): Promise<string | null> {
  for (const n of ['album.png', 'album.jpg', 'album.jpeg', 'album.webp']) {
    try {
      const buf = await fsp.readFile(join(folderAbs, n))
      if (buf.length > 6 * 1024 * 1024) return null // příliš velké → přeskoč
      const ext = n.slice(n.lastIndexOf('.') + 1)
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`
    } catch {
      /* zkus další název */
    }
  }
  return null
}

/**
 * Detailní info pro bohatý řádek v knihovně — VŠE ze `song.ini` (žádné parsování
 * chartu): název/umělec/charter/album/žánr/rok/délka + obtížnosti nástrojů
 * (diff_* jsou tam přímo, stejná stupnice 0–6 jako u vyhledávání). Vrací null,
 * když song.ini chybí.
 */
export async function readSongInfo(
  folderAbs: string
): Promise<Omit<import('../../shared/types').LibSongInfo, 'rel'> | null> {
  let txt: string
  try {
    txt = await fsp.readFile(join(folderAbs, 'song.ini'), 'utf-8')
  } catch {
    return null
  }
  const g = (k: string): string | undefined =>
    new RegExp(`^\\s*${k}\\s*=\\s*(.*)$`, 'im').exec(txt)?.[1]?.trim()
  // Tier: <=0 nebo chybí = nezahráno (konzistentní s vyhledáváním).
  const diff = (k: string): number | undefined => {
    const v = g(k)
    if (v === undefined) return undefined
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n > 0 ? Math.min(n, 6) : undefined
  }
  const lenMs = parseInt(g('song_length') ?? '', 10)
  const yr = parseInt(g('year') ?? '', 10)
  const difficulties: InstrumentDifficulties = {
    guitar: diff('diff_guitar'),
    bass: diff('diff_bass'),
    drums: diff('diff_drums') ?? diff('diff_drums_real'),
    vocals: diff('diff_vocals'),
    keys: diff('diff_keys') ?? diff('diff_keys_real')
  }
  // Display-only data → tagy pryč (editor čte syrově přes readSongMeta).
  return {
    title: stripRichTags(g('name') ?? ''),
    artist: stripRichTags(g('artist') ?? ''),
    charter: stripRichTags(g('charter') ?? g('frets') ?? ''),
    album: stripRichTags(g('album') ?? ''),
    genre: stripRichTags(g('genre') ?? ''),
    year: Number.isFinite(yr) ? yr : null,
    lengthSeconds: Number.isFinite(lenMs) ? Math.round(lenMs / 1000) : null,
    difficulties
  }
}
