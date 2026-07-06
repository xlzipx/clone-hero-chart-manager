// Klient pro Chorus Encore (enchor.us).
//
// Reverse-engineered API (z hlavního JS bundle www.enchor.us, ověřeno živým dotazem):
//   POST https://api.enchor.us/search
//   JSON body: { search, page (1-indexed), per_page?, instrument?, difficulty? }
//   Response: { found, out_of, page, data: [chart...] }
//
// Album art:  https://files.enchor.us/{albumArtMd5}.jpg
// Chart .sng: https://files.enchor.us/{md5}.sng
//
// Pozn.: Enchor jsou výhradně Clone Hero charty (žádné RB CON), takže
// `needsConversion` je vždy false. `song_length` je v MILISEKUNDÁCH.
//
// Obtížnosti: -1 = part nezahrán; 0..6 = tier.

import type { InstrumentDifficulties, SearchResponse, SongResult } from '../../shared/types'

const API = 'https://api.enchor.us'
const FILES = 'https://files.enchor.us'

interface EnchorChart {
  name?: string | null
  artist?: string | null
  album?: string | null
  genre?: string | null
  year?: string | number | null
  charter?: string | null
  song_length?: number | null // ms
  chartId?: number
  md5?: string | null
  albumArtMd5?: string | null
  parentFolderId?: string | null
  driveFileId?: string | null
  diff_guitar?: number
  diff_bass?: number
  diff_drums?: number
  diff_drums_real?: number
  diff_vocals?: number
  diff_keys?: number
  diff_band?: number
  diff_guitarghl?: number
  diff_bassghl?: number
  diff_rhythm?: number
  notesData?: {
    instruments?: string[]
  }
}

function diff(v: unknown): number | undefined {
  if (typeof v !== 'number' || v < 0) return undefined
  return Math.min(v, 6)
}

function mapDifficulties(c: EnchorChart): InstrumentDifficulties {
  // Zdroj pravdy jsou hodnoty `diff_*`: -1 = nezahráno, 0..6 = tier. Dřív jsme
  // seznam ořezávali podle `notesData.instruments`, jenže to pole je nespolehlivé
  // a neúplné — např. chart „Lola Young – SPIDERS" má diff_vocals=4, ale
  // instruments=["guitar"], takže se vokály chybně schovaly. Řídíme se proto
  // přímo tiery (diff() vrací undefined pro -1).
  return {
    guitar: diff(c.diff_guitar),
    bass: diff(c.diff_bass),
    drums: diff(c.diff_drums) ?? diff(c.diff_drums_real),
    vocals: diff(c.diff_vocals),
    keys: diff(c.diff_keys),
    guitarghl: diff(c.diff_guitarghl),
    bassghl: diff(c.diff_bassghl),
    band: diff(c.diff_band)
  }
}

function normalize(c: EnchorChart): SongResult {
  const md5 = c.md5 ?? ''
  const artMd5 = c.albumArtMd5 ?? ''
  const lenMs = typeof c.song_length === 'number' ? c.song_length : null
  const yearStr = c.year != null ? String(c.year) : ''
  const yearNum = parseInt(yearStr, 10)

  return {
    key: `enchor:${c.chartId ?? md5}`,
    fileId: null,
    songId: c.chartId ?? null,
    title: c.name ?? 'Unknown title',
    artist: c.artist ?? 'Unknown artist',
    album: c.album ?? '',
    year: Number.isFinite(yearNum) ? yearNum : null,
    genre: c.genre ?? '',
    lengthSeconds: lenMs != null ? Math.round(lenMs / 1000) : null,
    albumArtUrl: artMd5 ? `${FILES}/${artMd5}.jpg` : null,
    difficulties: mapDifficulties(c),
    // Chorus Encore nehlásí spolehlivě dostupné obtížnosti → neznámé.
    expertOnly: null,
    // Charter jde do UI SYROVĚ (vč. <color=…> tagů) — renderer je vykreslí
    // barevně jako hra (RichText). Stripovat jen tam, kde je třeba čistý text.
    charter: c.charter ?? null,
    source: 'Chorus Encore',
    gameFormat: 'sng',
    gameFormats: ['sng'],
    needsConversion: false,
    official: false,
    downloadUrl: md5 ? `${FILES}/${md5}.sng` : null,
    // Web Encore směruje na chart přes route `chart/:hash`, kde ten „hash" je
    // ve skutečnosti **md5** (ne chartId ani chartHash). Stránka pak volá
    // `/search/advanced { hash: md5 }` a chart najde. (Ověřeno proti live API +
    // JS bundlu: `copyLink(i.md5)` → `enchor.us/chart/${md5}`.)
    downloadPageUrl: md5 ? `https://www.enchor.us/chart/${md5}` : null,
    externalUrl: null,
    sizeBytes: null, // API ji nevrací; .sng je obvykle 5–50 MB
    // Google Drive složka, kde chart leží = charterova sbírka. Encore web z toho
    // dělá `drive.google.com/open?id=…`; `parentFolderId` je složka nad chartem.
    driveFolderUrl: c.parentFolderId
      ? `https://drive.google.com/open?id=${c.parentFolderId}`
      : null
  }
}

export async function search(
  text: string,
  page = 1,
  records = 25
): Promise<SearchResponse> {
  const body = {
    search: text,
    page,
    per_page: records
  }

  const res = await fetch(`${API}/search`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    throw new Error(`Chorus Encore API returned HTTP ${res.status}`)
  }
  const json: { found?: number; data?: EnchorChart[] } = await res.json()
  const rawSongs = Array.isArray(json.data) ? json.data : []
  return {
    songs: rawSongs.map(normalize),
    totalFiltered: typeof json.found === 'number' ? json.found : rawSongs.length,
    page,
    records
  }
}
