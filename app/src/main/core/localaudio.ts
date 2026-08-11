// Přehrávání zvuku písní, které už jsou v knihovně (Library manager, duplikáty).
//
// Na rozdíl od `preview.ts` (30s ukázka z iTunes/Deezeru párovaná podle jména)
// tady zvuk MÁME na disku — takže hraje přesně ten chart, na který se uživatel
// dívá, včetně coverů a remixů.
//
// Proč vlastní protokol a ne blob přes IPC jako u online ukázky: charty mají
// běžně desítky až stovky MB a bývají rozdělené na stopy. Poslat je celé přes
// IPC do paměti kvůli 30 s poslechu je nesmysl. `chm-audio://` umí Range
// requesty, takže `<audio>` si stáhne jen to, co zrovna hraje.
//
// CSP zůstává přísné: schéma je v `media-src` vypsané explicitně a handler
// pouští VÝHRADNĚ audio soubory zevnitř složky s knihovnou (viz `isAllowed`).

import { protocol } from 'electron'
import { createReadStream } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { extname, join, resolve, sep } from 'path'
import { Readable } from 'stream'
import type { SongAudio } from '../../shared/types'
import { getConfig } from './config'

export const AUDIO_SCHEME = 'chm-audio'

/** Přípony, ve kterých Clone Hero drží zvuk. */
const AUDIO_EXT = new Set(['.ogg', '.mp3', '.wav', '.opus'])

const MIME: Record<string, string> = {
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
}

/**
 * Soubory, které NEJSOU součástí mixu. `preview.*` je samostatná ukázka (hraje
 * se místo stop, ne k nim) a `crowd` je potlesk publika — ten by v ukázce spíš
 * překážel. Zbytek (song, guitar, bass, rhythm, keys, vocals, drums_1..4, …)
 * jsou stopy jedné skladby a musí hrát SOUČASNĚ, jinak zní mix děravě.
 */
const EXCLUDED_STEMS = /^(crowd)/i

/**
 * Musí se zavolat PŘED `app.whenReady()`. `stream: true` je tu podstatné —
 * bez něj Chromium schéma nepustí do `<audio>` a nepodpoří Range requesty.
 */
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: { supportFetchAPI: true, stream: true, secure: true, standard: true }
    }
  ])
}

/** Sestaví URL pro renderer. Cesta jde celá do jednoho segmentu → žádné escapování oddělovačů. */
export function audioUrl(absPath: string): string {
  return `${AUDIO_SCHEME}://file/${encodeURIComponent(absPath)}`
}

/**
 * Pustí ven jen audio soubory ležící UVNITŘ složky s knihovnou. Bez téhle
 * kontroly by stránka mohla přes vlastní schéma číst libovolný soubor na disku.
 */
function isAllowed(absPath: string): boolean {
  if (!AUDIO_EXT.has(extname(absPath).toLowerCase())) return false
  const root = getConfig().songsDir
  if (!root) return false
  const base = resolve(root)
  const target = resolve(absPath)
  // `sep` na konci: jinak by „…/Songs2" prošlo jako podsložka „…/Songs".
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep)
}

/**
 * Relativní cesta ke složce písně → absolutní, s kontrolou, že nevede ven
 * z knihovny (stejná ochrana jako `safeAbs` v `librarymgr`).
 */
function songFolderAbs(rel: string): string {
  const root = getConfig().songsDir
  if (!root) throw new Error('Songs library is not set')
  const base = resolve(root)
  const abs = resolve(base, rel || '.')
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error('Path is outside the Songs library')
  }
  return abs
}

/** Zaregistruje handler. Volat až po `app.whenReady()`. */
export function handleAudioProtocol(): void {
  protocol.handle(AUDIO_SCHEME, async (req) => {
    let absPath: string
    try {
      absPath = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
    } catch {
      return new Response(null, { status: 400 })
    }
    if (!isAllowed(absPath)) return new Response(null, { status: 403 })

    let size: number
    try {
      size = (await stat(absPath)).size
    } catch {
      return new Response(null, { status: 404 })
    }

    const type = MIME[extname(absPath).toLowerCase()] ?? 'audio/ogg'
    const range = req.headers.get('range')
    // Range je u médií pravidlo, ne výjimka: přehrávač si napřed vyžádá kousek
    // hlavičky a po přeskočení na preview_start_time si řekne o zbytek.
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0
      const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
      if (!(start >= 0 && start <= end && end < size)) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const body = Readable.toWeb(createReadStream(absPath, { start, end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          // Přehrávač si stopy tahá i přes Web Audio (`crossOrigin='anonymous'`
          // kvůli normalizaci hlasitosti). Bez CORS hlavičky by MediaElementSource
          // dostal „tainted" (tiché) vzorky. Zdroj je náš vlastní chráněný protokol.
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    const body = Readable.toWeb(createReadStream(absPath)) as ReadableStream
    return new Response(body, {
      headers: {
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
}

/** `preview_start_time` ze `song.ini` v ms (chybí-li, null). */
async function readPreviewStart(folderAbs: string): Promise<number | null> {
  try {
    const txt = await readFile(join(folderAbs, 'song.ini'), 'utf-8')
    const m = /^\s*preview_start_time\s*=\s*(-?\d+)/im.exec(txt)
    if (!m) return null
    const ms = parseInt(m[1], 10)
    // -1 = „nemám" (píše ho část nástrojů), záporné hodnoty ignoruj.
    return Number.isFinite(ms) && ms > 0 ? ms : null
  } catch {
    return null
  }
}

/**
 * Najde zvuk ve složce písně. Když je k dispozici hotová `preview.*`, použije
 * se sama; jinak vrátí VŠECHNY stopy, které renderer pustí naráz jako jeden mix.
 */
export async function getSongAudio(rel: string): Promise<SongAudio> {
  const empty: SongAudio = { tracks: [], previewStartMs: null }
  // Cesta chodí relativně ke knihovně (stejně jako zbytek `lib:*` API) —
  // `songFolderAbs` ohlídá, že se přes „..“ nedá vylézt ven.
  let folderAbs: string
  try {
    folderAbs = songFolderAbs(rel)
  } catch {
    return empty
  }

  let names: string[]
  try {
    names = (await readdir(folderAbs, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
  } catch {
    return empty
  }

  const { picked, preview } = pickAudioNames(names)
  if (picked.length === 0) return empty

  return {
    tracks: picked.sort().map((n) => ({ name: n, url: audioUrl(join(folderAbs, n)) })),
    // U hotové ukázky se na preview_start_time nekouká — ta začíná od začátku.
    previewStartMs: preview ? null : await readPreviewStart(folderAbs)
  }
}

/** Ze seznamu souborů složky vybere ty, co tvoří mix (stejná logika pro přehrávání
 *  i pro signaturu cache hlasitosti). `preview.*` má přednost před stopami. */
function pickAudioNames(names: string[]): { picked: string[]; preview: string | undefined } {
  const audio = names.filter((n) => AUDIO_EXT.has(extname(n).toLowerCase()))
  const preview = audio.find((n) => /^preview\./i.test(n))
  const picked = preview
    ? [preview]
    : audio.filter((n) => !/^preview\./i.test(n) && !EXCLUDED_STEMS.test(n))
  return { picked, preview }
}

/**
 * Signatura zvukových souborů písně (název:velikost:mtime) — klíč pro cache
 * naměřené hlasitosti. Když se soubory ve složce změní (jiný chart, re-download),
 * signatura se rozejde a hodnota se přeměří. `null` = složka bez použitelného zvuku.
 */
export async function getSongAudioSig(rel: string): Promise<string | null> {
  let folderAbs: string
  try {
    folderAbs = songFolderAbs(rel)
  } catch {
    return null
  }
  let names: string[]
  try {
    names = (await readdir(folderAbs, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
  } catch {
    return null
  }
  const { picked } = pickAudioNames(names)
  if (picked.length === 0) return null
  const parts: string[] = []
  for (const n of picked.sort()) {
    try {
      const s = await stat(join(folderAbs, n))
      parts.push(`${n}:${s.size}:${Math.round(s.mtimeMs)}`)
    } catch {
      return null
    }
  }
  return parts.join('|')
}
