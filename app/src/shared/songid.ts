/**
 * Odvození klíčů identity písně — JEDEN zdroj pravdy sdílený main i rendererem.
 *
 * Historicky žila tatáž logika okopírovaná na čtyřech místech (utils `songKey`,
 * library `normKey`, duplicates `norm`, both-merge klíč v ipc i store). Když se
 * jedna kopie změnila a ostatní ne, „už mám v knihovně" nebo dedup přestaly sedět.
 * Cokoli, co porovnává písně podle jména, má teď vycházet odsud.
 */
import type { InstrumentDifficulties, SongResult, SortKey } from './types'

/** Normalizace textu na porovnání: malá písmena, jen alfanumerika. */
export function normText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Klíč „stejná píseň bez ohledu na verzi": `artist|title` (alfanum, lowercase).
 * Slouží k párování s knihovnou („In library") a k dedupu duplicit.
 * POZOR: main `normKey` i renderer `songKey` MUSÍ vracet totéž — proto oba sem.
 */
export function songKey(artist: string, title: string): string {
  return `${normText(artist)}|${normText(title)}`
}

/** Pořadí nástrojů v podpisu obtížností (musí sedět s DIFF_KEYS v catalog.ts). */
export const MERGE_DIFF_ORDER: (keyof InstrumentDifficulties)[] = [
  'guitar',
  'bass',
  'drums',
  'vocals',
  'keys',
  'proGuitar',
  'proBass',
  'proKeys',
  'guitarghl',
  'bassghl',
  'band'
]

/**
 * Klíč „konkrétní chart" pro merge dvou databází v režimu „Both". Kromě
 * artist|title|charter obsahuje i PODPIS OBTÍŽNOSTÍ (tier každého nástroje +
 * expert-only). Bez něj se pod stejným artist|title|charter slévaly reálně JINÉ
 * charty téhož chartera (jiné nástroje/obtížnost, jiné verze) — změřeno 83 % ze
 * slučovaných skupin. Podpis to zúží tak, že se sloučí jen opravdu identické
 * charty (tentýž chart cross-postnutý na obě DB, formátové varianty téže věci);
 * různé charty zůstanou oddělené. Když se tentýž chart mezi RV a Encore liší
 * hlášenými obtížnostmi, radši se ukáže 2× než aby se ztratil.
 */
export function mergeKeyRaw(
  artist: string,
  title: string,
  charter: string | null,
  tiers: (number | null | undefined)[],
  expertOnly: boolean | null
): string {
  const t = (v: string): string => v.trim().toLowerCase()
  const sig =
    tiers.map((x) => (x == null ? '-' : String(x))).join(',') +
    '|' +
    (expertOnly == null ? '-' : expertOnly ? '1' : '0')
  return `${t(artist)}|${t(title)}|${t(charter ?? '')}|${sig}`
}

export function mergeKey(s: SongResult): string {
  return mergeKeyRaw(
    s.artist,
    s.title,
    s.charter,
    MERGE_DIFF_ORDER.map((k) => s.difficulties[k]),
    s.expertOnly
  )
}

/**
 * Sloučí výsledky RhythmVerse + Encore pro režim „Both" a odduplikuje je podle
 * [[mergeKey]]. Pořadí: normálně Encore první (přímý `.sng` hosting bývá
 * spolehlivější než scrape Google Drive), VÝJIMKA u „Most downloaded" — Encore
 * počet stažení nemá (řadil by se náhodně), tak jde napřed RhythmVerse.
 *
 * POZOR: main (ipc.ts, mělká stránka) i renderer (store.ts, hluboká „Both" přes
 * chunky) MUSÍ slučovat STEJNĚ, jinak by se pořadí mezi mělkými a hlubokými
 * stránkami rozešlo — proto to žije jen tady.
 */
export function mergeBoth(
  rvSongs: SongResult[],
  enSongs: SongResult[],
  sort?: SortKey
): SongResult[] {
  const ordered = sort === 'downloads' ? [...rvSongs, ...enSongs] : [...enSongs, ...rvSongs]
  const seen = new Set<string>()
  const out: SongResult[] = []
  for (const s of ordered) {
    const k = mergeKey(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}
