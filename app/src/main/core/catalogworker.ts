// Čtecí vlákno lokálního katalogu.
//
// Dotaz do katalogu (filtry interpreta, chartera, „Both" s dedup sondou…) trvá
// stovky ms a better-sqlite3 je synchronní. V hlavním procesu by na tu dobu
// zastavil i doručování vstupu do okna — psaní do filtrů se pak zasekávalo.
// Tady běží na vlastním spojení (jen pro čtení, WAL dovolí souběh se zápisy
// syncu v hlavním procesu) a hlavní proces jen čeká na odpověď.

import { parentPort, workerData } from 'worker_threads'
import { clearCountCache, openCatalogReader, queryCatalog, setOwnedKeys } from './catalog'

type Msg =
  | { type: 'query'; id: number; q: Parameters<typeof queryCatalog>[0] }
  | { type: 'owned'; keys: string[] }
  | { type: 'invalidate' }

openCatalogReader((workerData as { dbPath: string }).dbPath)

parentPort?.on('message', (m: Msg) => {
  if (m.type === 'query') {
    try {
      parentPort?.postMessage({ id: m.id, ok: true, res: queryCatalog(m.q) })
    } catch (e) {
      parentPort?.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  } else if (m.type === 'owned') {
    try {
      setOwnedKeys(m.keys)
    } catch {
      /* bez sady vlastněných jen nefunguje „Hide owned" */
    }
  } else if (m.type === 'invalidate') {
    clearCountCache()
  }
})
