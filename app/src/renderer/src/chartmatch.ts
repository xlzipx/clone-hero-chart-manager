import type { Database, SongResult } from '../../shared/types'
import { isAutoDownloadable, stripTags } from './utils'

// Dohledání chartu k písni podle interpreta + názvu — sdílí ho import playlistu
// (Spotify) i hromadná oprava rozbitých písní v knihovně. Ověřeno prototypem:
// hledat podle NÁZVU (ne „interpret + název") a interpreta dopárovat mezi výsledky.

const RECORDS = 60

// Očisti název skladby od šumu (remaster/verze/feat…), jinak i existující chart vypadne.
const NOISE_RE =
  /\s*[-–]\s*[^-–]*\b(?:remaster(?:ed)?|mono|stereo|version|mix|edit|live|remix|deluxe|anniversary|single|album|acoustic|demo|radio|re-?recorded)\b.*$/i
export function normTitle(t: string): string {
  return t
    .replace(NOISE_RE, '')
    .replace(/\s*\((?:feat|ft|with)\.?[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .trim()
}
// Srovnávací klíč: bez diakritiky, bez „the ", jen alfanum. Nelatinková písmena
// (azbuka…) zůstávají, jinak by z ruského názvu zbyl prázdný klíč.
export function keyOf(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}
// Hlavní interpret (bez feat./doprovodu). Slovní oddělovače (feat/ft/x/with)
// MUSÍ mít kolem sebe mezeru — jinak „ft"/„feat" jako podřetězec zmrší jména
// typu „Daft Punk" → „Da" nebo „Kraftwerk" → „Kra".
export function mainArtist(a: string): string {
  return a.split(/\s*,\s*|\s*&\s*|\s+(?:featuring|feat|ft|with|x)\.?\s+/i)[0]?.trim() || a
}

/**
 * Verze chartu pro danou píseň, nejlepší první: (stejný charter) → stáhne se
 * sám → bez konverze → nejvíc stažení. `charter` = preferovaný charter
 * (např. z song.ini rozbité složky).
 */
export async function findChartVersions(
  artist: string,
  title: string,
  db: Database,
  charter?: string
): Promise<SongResult[]> {
  const nt = normTitle(title)
  if (!nt) return []
  let songs: SongResult[]
  try {
    // system 'all' = nejširší pokrytí chartů (CH + PS + RB). Fulltext hledá jen
    // podle NÁZVU a je „fuzzy" — „Iris" chytne i „Osiris", „Irish Blood"…
    // Řazení podle STAŽENÍ dostane populární verze skutečné písně do okna.
    const resp = await window.api.search(nt, 1, RECORDS, 'all', db, undefined, 'downloads')
    songs = resp.songs
  } catch {
    return []
  }
  const wantT = keyOf(nt)
  const wantA = keyOf(mainArtist(artist))
  const hits = songs.filter((s) => {
    const st = keyOf(normTitle(s.title))
    const sa = keyOf(s.artist)
    const titleOk = st === wantT || (st.length > 3 && (st.includes(wantT) || wantT.includes(st)))
    const artistOk = !!wantA && (sa.includes(wantA) || wantA.includes(sa))
    return titleOk && artistOk
  })
  const wantC = charter ? keyOf(stripTags(charter)) : ''
  hits.sort((a, b) => {
    if (wantC) {
      const ca = keyOf(stripTags(a.charter ?? '')) === wantC ? 0 : 1
      const cb = keyOf(stripTags(b.charter ?? '')) === wantC ? 0 : 1
      if (ca !== cb) return ca - cb
    }
    const da = (isAutoDownloadable(a) ? 0 : 1) - (isAutoDownloadable(b) ? 0 : 1)
    if (da !== 0) return da
    const nc = (a.needsConversion ? 1 : 0) - (b.needsConversion ? 1 : 0)
    if (nc !== 0) return nc
    return (b.downloads ?? 0) - (a.downloads ?? 0)
  })
  return hits
}

/**
 * Interpret a název z názvu složky rozbité písně („Interpret - Název"), bez
 * přípon kopií („(2)", „ - kopie", „ - Copy") a „(RB3 Version)".
 */
export function songFromFolderName(name: string): { artist: string; title: string } {
  const clean = (x: string): string =>
    x
      .replace(/\((?:rb\d?|rock band[^)]*?)\s*version\)/gi, '')
      .replace(/(\w)_(s|t|m|d|ll|re|ve)\b/gi, "$1'$2")
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  let base = name.replace(/\.sng$/i, '')
  // Přípony kopií z Průzkumníka / Finderu, i opakované („… (2) - kopie").
  for (let i = 0; i < 3; i++) {
    base = base
      .replace(/\s*[-–]\s*(?:kopie|kopia|copy|kopie \(\d+\)|copy \(\d+\))\s*$/i, '')
      .replace(/\s+(?:copy|kopie)(?:\s+\d+)?\s*$/i, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim()
  }
  const dash = base.indexOf(' - ')
  return dash > 0
    ? { artist: clean(base.slice(0, dash)), title: clean(base.slice(dash + 3)) }
    : { artist: '', title: clean(base) }
}
