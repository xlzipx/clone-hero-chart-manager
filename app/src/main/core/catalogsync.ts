// Synchronizace lokálního katalogu (viz catalog.ts) s živými API.
//
// Princip: obě API umí řadit od NEJNOVĚJI změněných (Encore `modifiedTime`,
// RV `update_date`). Sync tedy prochází katalog newest-first. První běh (bez
// kurzoru) projde celý katalog — plný build; další běhy jsou delta: pár
// requestů, zastaví se, jakmile je celá stránka starší než kurzor minulého
// doběhnutého syncu.
//
// Tempo: oba zdroje jedou PARALELNĚ vedle sebe, každý svou disciplínou —
// Encore přísně sériově (souběžné požadavky shazuje na 503, ověřeno živě),
// RhythmVerse se souběhem 3 (snese ho). Použitelnost je PER-ZDROJ
// (`full_done:en` / `full_done:rv`) — každá záložka naskočí hned po
// dostavění SVÉHO zdroje (RV ~4 min, Encore ~7 min). Fetch má timeouty a
// stránky se po síťové chybě párkrát zopakují; selhání celého zdroje se
// zkusí znovu za 5 minut (a naváže, nezačíná od nuly).
//
// Přerušení: build si po každé stránce ukládá pozici (`build_page`) a příští
// spuštění NAVÁŽE, kde přestalo — newest-first řazení posouvá obsah jen
// „dolů" (nové charty přibývají nahoře), takže pokračování od uložené stránky
// nic nemine; drobný překryv je neškodný (upsert je idempotentní). Kurzor po
// dokončení = ČAS ZAČÁTKU buildu — vše změněné během stavění dožene první
// delta (24h překryv absorbuje i posun hodin serveru).
//
// Smazané charty se záměrně NEŘEŠÍ (žádný periodický reconcile): mizí vzácně
// a mrtvý řádek se projeví nanejvýš srozumitelnou chybou při stahování.

import type { CatalogStatus } from '../../shared/types'
import * as catalog from './catalog'
import * as enchor from './enchor'
import * as rhythmverse from './rhythmverse'

/** Pauza mezi stránkami (ohleduplnost k API + 503 prevence u Encore). */
const PAGE_DELAY_MS = 150
/** Souběh stránek RhythmVerse (deep scan jede na 4 bez potíží). */
const RV_CONCURRENCY = 3
/** Překryv kurzoru — o kolik „do minulosti" delta přesahuje (posun hodin
 *  serveru + záznamy změněné během předchozího syncu). */
const CURSOR_OVERLAP_MS = 24 * 60 * 60 * 1000
/** Jak starý rozestavěný build má ještě cenu navazovat (jinak od začátku). */
const RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** Perioda delta syncu za běhu appky. */
const PERIODIC_MS = 30 * 60 * 1000
/** Odklad prvního syncu po startu (ať nesoupeří se startem UI a update checkem). */
const STARTUP_DELAY_MS = 8000
/** Za jak dlouho zkusit sync znovu, když selhal (ne až za celou periodu). */
const FAIL_RETRY_MS = 5 * 60 * 1000
/** Kolikrát zopakovat JEDNU stránku po síťové chybě/timeoutu, než se zdroj vzdá. */
const PAGE_RETRIES = 2

type Source = 'rv' | 'en'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let syncing = false
/** Průběh plného buildu každého zdroje 0..1 (delta je moc rychlá na progress). */
const srcProgress: Record<Source, number> = { rv: 1, en: 1 }
/** Váhy do kombinovaného progressu (Encore má ~380 sériových stránek). */
const WEIGHT: Record<Source, number> = { rv: 0.35, en: 0.65 }
let notify: ((s: CatalogStatus) => void) | null = null
let periodicTimer: NodeJS.Timeout | null = null

/** Sestaví aktuální status. Bez inicializované DB (selhal init / dotaz přišel
 *  moc brzy) vrací bezpečné „empty" — renderer pak prostě jede přes živá API. */
export function getCatalogStatus(): CatalogStatus {
  try {
    return statusFromDb()
  } catch {
    return {
      state: 'empty',
      usable: false,
      progress: 1,
      sources: { rv: { ready: false, progress: 1 }, en: { ready: false, progress: 1 } },
      counts: { rv: 0, en: 0 },
      lastSync: null
    }
  }
}

function statusFromDb(): CatalogStatus {
  const counts = catalog.counts()
  const rvReady = catalog.getMeta('full_done:rv') === '1'
  const enReady = catalog.getMeta('full_done:en') === '1'
  const last = catalog.getMeta('last_sync')
  const progress = srcProgress.rv * WEIGHT.rv + srcProgress.en * WEIGHT.en
  return {
    state: syncing ? 'syncing' : rvReady && enReady ? 'ready' : 'empty',
    usable: rvReady && enReady,
    progress: syncing ? Math.min(1, progress) : 1,
    sources: {
      rv: { ready: rvReady, progress: syncing ? srcProgress.rv : 1 },
      en: { ready: enReady, progress: syncing ? srcProgress.en : 1 }
    },
    counts,
    lastSync: last ? Number(last) : null
  }
}

function emit(): void {
  notify?.(getCatalogStatus())
}

/** Stránkovací funkce zdroje (enchor/rhythmverse mají identický tvar). */
type PageFetcher = (page: number) => Promise<enchor.CatalogPageResult>

/** Obal fetchPage s retry na síťovou chybu/timeout (1s/3s backoff). HTTP chyby
 *  řeší klienti sami (Encore retryuje 503/429 uvnitř postSearch). */
function withRetry(fetchPage: PageFetcher): PageFetcher {
  return async (page) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchPage(page)
      } catch (err) {
        if (attempt >= PAGE_RETRIES) throw err
        await sleep(1000 * (attempt * 2 + 1))
      }
    }
  }
}

/** Delta sync hotového zdroje: newest-first, stop na kurzoru. */
async function deltaSync(src: Source): Promise<void> {
  const perPage = src === 'en' ? enchor.ENCHOR_CATALOG_PER_PAGE : rhythmverse.RV_CATALOG_RECORDS
  const fetchPage = withRetry(
    src === 'en' ? enchor.fetchCatalogPage : rhythmverse.fetchCatalogPage
  )
  const cursorRaw = catalog.getMeta(`cursor:${src}`)
  const cursor = (cursorRaw ? Number(cursorRaw) : 0) - CURSOR_OVERLAP_MS
  const runStart = Date.now()

  let totalPages = 1
  for (let page = 1; page <= totalPages; page++) {
    const res = await fetchPage(page)
    if (page === 1) totalPages = Math.max(1, Math.ceil(res.found / perPage))
    if (res.items.length === 0) break
    catalog.upsertMany(
      res.items.map((it) => ({ src, uid: it.uid, modifiedMs: it.modifiedMs, song: it.song }))
    )
    if (res.items.every((it) => it.modifiedMs < cursor)) break
    if (page < totalPages) await sleep(PAGE_DELAY_MS)
  }
  // Kurzor = začátek TOHOHLE běhu (vše starší je teď v DB).
  catalog.setMeta(`cursor:${src}`, String(runStart))
}

/** Plný build zdroje, s navázáním na přerušený běh (`build_page`). */
async function fullBuild(src: Source, concurrency: number): Promise<void> {
  const perPage = src === 'en' ? enchor.ENCHOR_CATALOG_PER_PAGE : rhythmverse.RV_CATALOG_RECORDS
  const fetchPage = withRetry(
    src === 'en' ? enchor.fetchCatalogPage : rhythmverse.fetchCatalogPage
  )

  let startPage = 1
  const startedRaw = catalog.getMeta(`build_started:${src}`)
  const resumeRaw = catalog.getMeta(`build_page:${src}`)
  if (resumeRaw && startedRaw && Date.now() - Number(startedRaw) < RESUME_MAX_AGE_MS) {
    startPage = Math.max(1, Number(resumeRaw) + 1)
    console.log(`[catalog] resuming ${src} build from page ${startPage}`)
  } else {
    catalog.setMeta(`build_started:${src}`, String(Date.now()))
    catalog.delMeta(`build_page:${src}`)
  }

  let totalPages = startPage
  let known = false // totalPages je odhad, dokud nedorazí první odpověď
  outer: for (let start = startPage; start <= totalPages; start += concurrency) {
    const batch: number[] = []
    for (let p = start; p < start + concurrency && (p <= totalPages || !known); p++) batch.push(p)
    const pages =
      batch.length > 1 ? await Promise.all(batch.map(fetchPage)) : [await fetchPage(batch[0])]
    for (let i = 0; i < pages.length; i++) {
      const res = pages[i]
      if (!known) {
        totalPages = Math.max(1, Math.ceil(res.found / perPage))
        known = true
      }
      if (res.items.length === 0) break outer // katalog došel dřív, než tvrdil `found`
      catalog.upsertMany(
        res.items.map((it) => ({ src, uid: it.uid, modifiedMs: it.modifiedMs, song: it.song }))
      )
      catalog.setMeta(`build_page:${src}`, String(batch[i]))
    }
    srcProgress[src] = Math.min(1, batch[batch.length - 1] / Math.max(totalPages, 1))
    emit()
    if (start + concurrency <= totalPages) await sleep(PAGE_DELAY_MS)
  }

  // Kurzor = čas ZAČÁTKU buildu — co se změnilo během stavění, dožene první
  // delta. `build_started` přežívá i navázání, takže platí pro celý build.
  const buildStart = Number(catalog.getMeta(`build_started:${src}`) ?? Date.now())
  catalog.setMeta(`cursor:${src}`, String(buildStart))
  catalog.setMeta(`full_done:${src}`, '1')
  catalog.delMeta(`build_page:${src}`)
  catalog.delMeta(`build_started:${src}`)
  srcProgress[src] = 1
  emit()
}

async function syncSource(src: Source, concurrency: number): Promise<void> {
  if (catalog.getMeta(`full_done:${src}`) === '1') return deltaSync(src)
  return fullBuild(src, concurrency)
}

/**
 * Kompletní sync obou zdrojů PARALELNĚ vedle sebe, každý svou disciplínou
 * (Encore sériově, RV souběh 3). Změřeno: Encore je limitovaný latencí svého
 * serveru (~1,2 s/stránku, s RV vedle i bez), takže paralelní RV ho
 * NEzpomaluje — a sám je hotový za ~4 min místo čekání na Encore. Dřívější
 * „viset na 2 %" nezpůsoboval souběh, ale zamrzlý fetch bez timeoutu (dnes
 * vyřešeno timeouty + retry). Použitelnost je per-zdroj — každá záložka
 * naskočí, hned jak je JEJÍ zdroj hotový. Selhání jednoho zdroje neblokuje
 * druhý a sync se pak zopakuje za FAIL_RETRY_MS (build naváže díky
 * `build_page`, nezačíná od nuly). Souběžné volání se tiše slije do jednoho.
 */
export async function syncCatalog(): Promise<void> {
  if (syncing) return
  syncing = true
  const st = getCatalogStatus()
  srcProgress.en = st.sources.en.ready ? 1 : 0
  srcProgress.rv = st.sources.rv.ready ? 1 : 0
  emit()
  const results = await Promise.allSettled([
    syncSource('en', 1),
    syncSource('rv', RV_CONCURRENCY)
  ])
  let okAll = true
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      okAll = false
      console.warn(`[catalog] ${i === 0 ? 'en' : 'rv'} sync failed:`, r.reason)
    }
  })
  if (okAll) {
    catalog.setMeta('last_sync', String(Date.now()))
  } else {
    // Přechodný výpadek (síť, server) → nečekat celou periodu; build mezitím
    // stojí na uložené stránce a retry na ni naváže.
    setTimeout(() => {
      void syncCatalog()
    }, FAIL_RETRY_MS).unref?.()
  }
  syncing = false
  srcProgress.rv = 1
  srcProgress.en = 1
  emit()
}

/**
 * Naplánuje sync: první běh chvíli po startu, pak periodicky. `onStatus`
 * dostává změny stavu (push do rendereru).
 */
export function scheduleCatalogSync(onStatus: (s: CatalogStatus) => void): void {
  notify = onStatus
  setTimeout(() => {
    void syncCatalog()
  }, STARTUP_DELAY_MS).unref?.()
  periodicTimer = setInterval(() => {
    void syncCatalog()
  }, PERIODIC_MS)
  periodicTimer.unref?.()
}

export function stopCatalogSync(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }
  notify = null
}
