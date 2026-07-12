import type { InstrumentDifficulties, SongResult } from '../../shared/types'
import type { IconName } from './components/Icon'

// Discovery chipy pro prázdný stav — kurátorské populární kapely, které na RV
// spolehlivě vrací hodně chartů. (Žánr ani rok RV API nefiltruje, jen text
// v názvu/umělci, takže žánrové/dekádové chipy by byly zavádějící.)
export const QUICK_PICKS: string[] = [
  'Metallica', 'Foo Fighters', 'Nirvana', 'Green Day', 'Queen', 'AC/DC',
  'Linkin Park', 'Red Hot Chili Peppers', 'Iron Maiden', 'System of a Down',
  'Pearl Jam', 'Rush'
]

// RhythmVerse `list`/`search` stránkuje jen do 249. stránky — dál vrací pořád
// tutéž „přetečenou" stránku (ověřeno živě: records 25/100/250 přetečou od strany
// 250 shodně). Pager proto v režimech s RhythmVerse (rhythmverse i both) stropujeme
// na 249; Encore stránkuje do hloubky, tam se strop neuplatní.
export const RV_PAGE_CAP = 249

// Pro HLUBOKÉ stránky RhythmVerse (za 249. serverovou stranou) tahneme velké
// serverové stránky téhle velikosti a lokálně je krájíme na `records`. Musí být tak
// velká, aby se CELÝ katalog vešel do ≤249 stran i v nejširším systému „All"
// (~140 tis.): 249×700 = 174 300 > 140 tis. → celý RV proklikatelný. Dělitelné
// běžnými records (25/50/100). (Ověřeno živě: RV `records=700` bere, „All" končí
// kolem strany 201, tedy pod mezí 249.)
export const RV_CHUNK = 700

export function formatLength(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '–'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Počet stažení s oddělovači tisíců (aktuální hodnota z API): 20100 → "20,100". */
export function formatDownloads(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return ''
  return n.toLocaleString('en-US')
}

export function formatLabel(format: string | null): string {
  if (!format) return '?'
  const map: Record<string, string> = {
    rb3xbox: 'RB3',
    rb3ps3: 'RB3 PS3',
    rb3wii: 'RB3 Wii',
    rb2xbox: 'RB2',
    clonehero: 'Clone Hero',
    ch: 'Clone Hero',
    chart: 'Clone Hero',
    ps: 'Phase Shift',
    phaseshift: 'Phase Shift',
    sng: 'SNG',
    rba: 'RBA'
  }
  return map[format.toLowerCase()] ?? format.toUpperCase()
}

export interface InstrumentMeta {
  id: keyof InstrumentDifficulties
  label: string
  short: string
  icon: IconName
  color: string
}

/** Pořadí a vzhled nástrojů v UI (jako RhythmVerse). */
export const INSTRUMENTS: InstrumentMeta[] = [
  { id: 'guitar', label: 'Guitar', short: 'G', icon: 'guitar', color: '#ff5b5b' },
  { id: 'bass', label: 'Bass', short: 'B', icon: 'bass', color: '#4a90e2' },
  { id: 'drums', label: 'Drums', short: 'D', icon: 'drums', color: '#f5c518' },
  { id: 'keys', label: 'Keys', short: 'K', icon: 'keys', color: '#d23bd2' },
  { id: 'vocals', label: 'Vocals', short: 'V', icon: 'vocals', color: '#2dd4bf' }
]

export const MAX_DIFFICULTY = 6

/**
 * Odstraní CH/Unity rich-text tagy (<color=…>, <b>, …) → čistý text pro
 * filtrování, kopírování a tooltips. Pro ZOBRAZENÍ použij komponentu RichText,
 * která tagy vykreslí barevně jako hra.
 */
export function stripTags(s: string): string {
  return s.replace(/<\/?(?:color|b|i|u|s|size|material|quad|sprite|alpha|mark|noparse)\b[^>]*>/gi, '').trim()
}

/** Normalizovaný klíč skladby (musí sedět s main `normKey`): artist|title. */
export function songKey(artist: string, title: string): string {
  const n = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${n(artist)}|${n(title)}`
}

export type ManualHost = 'MEGA' | 'Mediafire' | 'Shortener' | null

export const SHORTENER_RE =
  /^https?:\/\/(?:[a-z0-9-]+\.)?(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|buff\.ly|is\.gd|v\.gd|cutt\.ly|shorturl\.at|rb\.gy)\//i

/** Hostitelé, u kterých nemáme spolehlivé auto-stažení (MEGA / Mediafire / shortener). */
export function detectManualHost(source: string | null, url: string | null): ManualHost {
  const src = (source || '').toLowerCase()
  if (src.includes('mega')) return 'MEGA'
  if (src.includes('mediafire')) return 'Mediafire'
  if (!url) return null
  if (/mega\.(nz|co\.nz|io)/i.test(url)) return 'MEGA'
  if (/mediafire\.com/i.test(url)) return 'Mediafire'
  if (SHORTENER_RE.test(url)) return 'Shortener'
  return null
}

/**
 * Lze píseň stáhnout automaticky (bez ruční interakce)? Používá batch download,
 * aby nezařazoval oficiální DLC ani MEGA/Mediafire/shortener odkazy, které
 * vyžadují ruční krok a jen by zaplavily frontu chybami.
 */
export function isAutoDownloadable(song: SongResult): boolean {
  if (song.official) return false
  const url = song.downloadUrl || song.downloadPageUrl
  if (!url) return false
  return detectManualHost(song.source, url) === null
}
