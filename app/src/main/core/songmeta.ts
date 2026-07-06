// Čtení a zápis metadat písně (`song.ini`). Zachovává neznámé klíče i strukturu
// souboru — mění jen zadaná pole v sekci [song].

import { promises as fsp } from 'fs'
import { join } from 'path'
import type { SongMeta } from '../../shared/types'

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
    const val = fields[key]
    if (val === undefined) continue
    const re = new RegExp(`^(\\s*${key}\\s*=).*$`, 'i')
    const idx = lines.findIndex((l) => re.test(l))
    if (idx >= 0) {
      lines[idx] = lines[idx].replace(re, `$1 ${val}`)
    } else {
      // Vlož hned za hlavičku [Song].
      lines.splice(headerIdx + 1, 0, `${key} = ${val}`)
    }
  }

  await fsp.writeFile(iniPath, lines.join(eol), 'utf-8')
}
