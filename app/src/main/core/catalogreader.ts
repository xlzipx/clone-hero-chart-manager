// Dotazy do katalogu mimo hlavní proces (viz catalogworker.ts).
//
// Když se vlákno nepodaří spustit nebo spadne, dotazy jdou postaru přímo
// v hlavním procesu — pomaleji pro UI, ale funkčně stejně.

import { Worker } from 'worker_threads'
import { join } from 'path'
import type { CatalogQuery, SearchResponse } from '../../shared/types'
import { onCatalogDataChange, queryCatalog, setOwnedKeys } from './catalog'

let worker: Worker | null = null
let seq = 0
/** Poslední sada vlastněných písní — vlákno ji dostane i když se spustí později. */
let lastOwned: string[] | null = null
const pending = new Map<number, { resolve: (r: SearchResponse) => void; reject: (e: Error) => void }>()

function failAll(err: Error): void {
  for (const p of pending.values()) p.reject(err)
  pending.clear()
}

/** Spustí čtecí vlákno nad otevřeným katalogem. Volat po initCatalog. */
export function startCatalogReader(dbPath: string): void {
  if (worker) return
  try {
    const w = new Worker(join(__dirname, 'catalogworker.js'), { workerData: { dbPath } })
    w.on('message', (m: { id: number; ok: boolean; res?: SearchResponse; error?: string }) => {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok && m.res) p.resolve(m.res)
      else p.reject(new Error(m.error || 'Catalog query failed'))
    })
    const drop = (err: Error): void => {
      console.warn('[catalog] reader thread stopped:', err.message)
      if (worker === w) worker = null
      failAll(err)
    }
    w.on('error', drop)
    w.on('exit', (code) => {
      // Ukončené přes stopCatalogReader (zavírání appky) → nic nehlásit.
      if (worker !== w) return
      if (code !== 0) drop(new Error(`exit ${code}`))
      else worker = null
    })
    worker = w
    if (lastOwned) w.postMessage({ type: 'owned', keys: lastOwned })
    // Sync zapsal nová data → počty uložené ve vlákně přestaly platit.
    onCatalogDataChange(() => worker?.postMessage({ type: 'invalidate' }))
  } catch (err) {
    console.warn('[catalog] reader thread unavailable:', err)
    worker = null
  }
}

/** Dotaz do katalogu; ve vlákně, jinak (záložně) přímo. */
export async function queryCatalogAsync(q: CatalogQuery): Promise<SearchResponse> {
  const w = worker
  if (!w) return queryCatalog(q)
  const id = ++seq
  try {
    return await new Promise<SearchResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      w.postMessage({ type: 'query', id, q })
    })
  } catch (err) {
    // Vlákno spadlo uprostřed dotazu → zkusit postaru, ať uživatel nic nepozná.
    if (!worker) return queryCatalog(q)
    throw err
  }
}

/** Sada vlastněných písní pro „Hide owned" — hlavní spojení i vlákno. */
export function setOwnedKeysEverywhere(keys: string[]): void {
  lastOwned = keys
  setOwnedKeys(keys)
  worker?.postMessage({ type: 'owned', keys })
}

export function stopCatalogReader(): void {
  const w = worker
  worker = null
  failAll(new Error('Catalog closed'))
  void w?.terminate()
}
