// Generátor SEED katalogu pro build (spouští ho build/build-catalog-seed.cjs
// pod Electron runtime přes ELECTRON_RUN_AS_NODE — better-sqlite3 binding je
// electron-ABI). Udělá plný sync obou databází do souboru z env SEED_OUT;
// výsledek se gzipne a přibalí do instalátoru (extraResources), takže uživatel
// při prvním spuštění katalog jen rozbalí a doháněí se pouze delta.
//
// ZÁMĚRNĚ žádné electron importy — běží jako čistý node skript.

/* eslint-disable no-console */
import { initCatalog, closeCatalog } from '../core/catalog'
import { getCatalogStatus, syncCatalog } from '../core/catalogsync'

async function main(): Promise<void> {
  const out = process.env.SEED_OUT
  if (!out) throw new Error('SEED_OUT env is not set')

  initCatalog(out)
  const t0 = Date.now()
  console.log('[seedgen] full sync starting…')
  const tick = setInterval(() => {
    const s = getCatalogStatus()
    console.log(
      `[seedgen] ${(s.progress * 100).toFixed(0)}% (rv=${s.counts.rv} en=${s.counts.en})`
    )
  }, 20_000)
  await syncCatalog()
  clearInterval(tick)

  const st = getCatalogStatus()
  if (!st.usable) {
    throw new Error(
      `seed sync did not complete (rv=${st.sources.rv.ready} en=${st.sources.en.ready})`
    )
  }
  closeCatalog() // checkpointne WAL → jediný .db soubor
  console.log(
    `[seedgen] done in ${((Date.now() - t0) / 60000).toFixed(1)} min — rv=${st.counts.rv} en=${st.counts.en}`
  )
}

main().catch((err) => {
  console.error('[seedgen] FAILED:', err)
  process.exit(1)
})
