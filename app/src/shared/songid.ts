/**
 * Odvození klíčů identity písně — JEDEN zdroj pravdy sdílený main i rendererem.
 *
 * Historicky žila tatáž logika okopírovaná na čtyřech místech (utils `songKey`,
 * library `normKey`, duplicates `norm`, both-merge klíč v ipc i store). Když se
 * jedna kopie změnila a ostatní ne, „už mám v knihovně" nebo dedup přestaly sedět.
 * Cokoli, co porovnává písně podle jména, má teď vycházet odsud.
 */
import type { SongResult } from './types'

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

/**
 * Klíč „konkrétní chart" pro merge dvou databází v režimu „Both": rozlišuje i
 * charter (jiný charter = jiný chart), ale toleruje drobné rozdíly velikosti/mezer.
 * Jemnější než `songKey` — nechce sloučit dvě různé verze do jedné.
 */
export function mergeKey(s: SongResult): string {
  const t = (v: string): string => v.trim().toLowerCase()
  return `${t(s.artist)}|${t(s.title)}|${t(s.charter ?? '')}`
}
