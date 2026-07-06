// Klient pro neoficiální RhythmVerse API.
//
//   POST https://rhythmverse.co/api/<system>/songfiles/search/live
//   form: text, data_type=full, records, page
//
// Systémy (slug v cestě):
//   ch    = Clone Hero (nativní .chart, stahování typicky z Google Drive) — DEFAULT
//   ps    = Phase Shift (notes.mid + song.ini, hosted na rhythmverse)
//   rb3   = Rock Band 3 (customy = CON balíčky → konverze; + oficiální DLC bez stažení)
//   all   = vše dohromady
//
// Pozn.: hodnota obtížnosti 0 nebo null znamená „part nezahraný"; 1–6 je tier.

import type { InstrumentDifficulties, SearchResponse, SongResult } from '../../shared/types'
import {
  anyNeedsConversion,
  formatNeedsConversion,
  isPs3Format,
  parsePhpStringArray
} from './gameformats'

const BASE = 'https://rhythmverse.co'

export type RhythmVerseSystem = 'ch' | 'ps' | 'rb3' | 'all'

function parseDiff(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const n = typeof value === 'number' ? value : parseInt(String(value), 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.min(n, 6)
}

/**
 * Obtížnosti nástrojů. Preferuje data KONKRÉTNÍHO souboru (`file`), který se
 * reálně stahuje — RhythmVerse je parsuje přímo z chartu, takže odpovídají tomu,
 * co bude ve hře. Song-level `data` je agregace přes všechny verze skladby a
 * použije se jen jako záloha, když file žádné obtížnosti nemá.
 */
function mapDifficulties(
  file: Record<string, unknown>,
  data: Record<string, unknown>
): InstrumentDifficulties {
  const keys = [
    'diff_guitar',
    'diff_bass',
    'diff_drums',
    'diff_vocals',
    'diff_keys',
    'diff_prokeys',
    'diff_band'
  ]
  const fileHasDiffs = keys.some((k) => file[k] !== undefined && file[k] !== null)
  const s = fileHasDiffs ? file : data
  return {
    guitar: parseDiff(s.diff_guitar),
    bass: parseDiff(s.diff_bass),
    drums: parseDiff(s.diff_drums),
    vocals: parseDiff(s.diff_vocals),
    keys: parseDiff(s.diff_keys),
    proGuitar: parseDiff(s.diff_proguitar),
    proBass: parseDiff(s.diff_probass),
    proKeys: parseDiff(s.diff_prokeys),
    guitarghl: parseDiff(s.diff_guitarghl),
    bassghl: parseDiff(s.diff_bassghl),
    band: parseDiff(s.diff_band)
  }
}

/**
 * Odvodí z RhythmVerse pole `file.difficulties` (per nástroj `{e,m,h,x,all}`),
 * jestli je chart jen na Expert. `has_reductions` je nespolehlivé (yes/automatic/
 * ""/no), zato tenhle objekt je vždy přítomný a přesný.
 *   - true  = žádný nacharovaný nástroj nemá E/M/H (jen Expert)
 *   - false = aspoň jeden nástroj má nižší obtížnost
 *   - null  = objekt chybí / nic nenacharováno
 */
function computeExpertOnly(diffs: unknown): boolean | null {
  if (!diffs || typeof diffs !== 'object') return null
  let anyCharted = false
  let anyReduction = false
  for (const inst of Object.values(diffs as Record<string, Record<string, number>>)) {
    if (!inst || typeof inst !== 'object') continue
    const charted =
      inst.x === 1 || inst.all === 1 || inst.h === 1 || inst.m === 1 || inst.e === 1
    if (charted) anyCharted = true
    if (inst.e === 1 || inst.m === 1 || inst.h === 1) anyReduction = true
  }
  if (!anyCharted) return null
  return !anyReduction
}

function absolutize(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  return BASE + (url.startsWith('/') ? url : '/' + url)
}

function pickArt(data: Record<string, unknown>, file: Record<string, unknown>): string | null {
  return absolutize((data.album_art as string) || (file.album_art as string) || null)
}

function pickCharter(file: Record<string, unknown>): string | null {
  // Syrově vč. případných <color=…> tagů — barevně vykreslí RichText v UI.
  if (file.charter) return String(file.charter)
  const author = file.author as { name?: string } | undefined
  if (author && author.name) return author.name
  return null
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeSong(song: { data: Record<string, unknown>; file: Record<string, unknown> }): SongResult {
  const d = song.data || {}
  const f = song.file || {}
  const formats = parsePhpStringArray(d.gameformats as string)
  const gameFormat = (f.gameformat as string) || formats[0] || null

  // Oficiální DLC (jen v obchodě – nelze stáhnout): odkaz na marketplace nebo
  // zdroj Harmonix / oficiální RB DLC.
  const dlRaw = String(f.download_url ?? '')
  const extRaw = String(f.external_url ?? '')
  const noDownload = !dlRaw || dlRaw.toLowerCase() === 'none'
  const isMarket = /marketplace\.xbox\.com|xbox\.com.*offers/i.test(dlRaw + ' ' + extRaw)
  const official =
    isMarket ||
    noDownload ||
    (f.gamesource as string) === 'rbdlc' ||
    (f.source as string) === 'hmx'

  return {
    key: String(f.file_id ?? d.record_id ?? d.song_id ?? `${d.artist}-${d.title}`),
    fileId: num(f.file_id),
    songId: num(d.song_id),
    title: String(d.title ?? f.file_title ?? 'Neznámý název'),
    artist: String(d.artist ?? f.file_artist ?? 'Neznámý umělec'),
    album: String(d.album ?? f.file_album ?? ''),
    year: num(d.year ?? f.file_year) || null,
    genre: String(d.genre ?? f.file_genre ?? ''),
    lengthSeconds: num(d.song_length ?? f.file_song_length),
    albumArtUrl: pickArt(d, f),
    difficulties: mapDifficulties(f, d),
    expertOnly: computeExpertOnly(f.difficulties),
    charter: pickCharter(f),
    source: (f.gamesource as string) || (f.source as string) || null,
    gameFormat,
    gameFormats: formats.length ? formats : gameFormat ? [gameFormat] : [],
    needsConversion: gameFormat
      ? formatNeedsConversion(gameFormat)
      : anyNeedsConversion(formats),
    official,
    downloadUrl: noDownload ? null : absolutize(f.download_url as string),
    downloadPageUrl:
      (f.download_page_url_full as string) || absolutize(f.download_page_url as string),
    externalUrl: (f.external_url as string) || null,
    sizeBytes: num(f.size)
  }
}

export async function search(
  text: string,
  page = 1,
  records = 25,
  system: RhythmVerseSystem = 'ch'
): Promise<SearchResponse> {
  const url = `${BASE}/api/${system}/songfiles/search/live`
  const body = new URLSearchParams()
  body.set('text', text)
  body.set('data_type', 'full')
  body.set('records', String(records))
  body.set('page', String(page))

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    },
    body: body.toString()
  })

  if (!res.ok) {
    throw new Error(`RhythmVerse API vrátilo HTTP ${res.status}`)
  }

  const json: any = await res.json()
  if (json.status !== 'success' || !json.data) {
    throw new Error('RhythmVerse API: neplatná odpověď')
  }

  const rawSongs: any[] = Array.isArray(json.data.songs) ? json.data.songs : []
  // PS3 soubory (šifrované EDAT, nekonvertovatelné) vyřadíme — jen matou.
  // Rozhoduje formát KONKRÉTNÍHO nabízeného souboru (f.gameformat), ne agregace
  // přes všechny verze písně: pokud tenhle řádek stahuje PS3 soubor, skryj ho.
  const songs = rawSongs.map(normalizeSong).filter((s) => !isPs3Format(s.gameFormat))

  return {
    songs,
    totalFiltered: num(json.data.records?.total_filtered) ?? songs.length,
    page,
    records
  }
}
