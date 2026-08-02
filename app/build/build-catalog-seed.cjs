// Vygeneruje PŘIBALENÝ seed katalogu (build/catalog-seed.db.gz) pro instalátor.
//
// Postup: esbuild zabalí src/main/tools/seedgen.ts → spustí se pod Electron
// runtime (ELECTRON_RUN_AS_NODE — better-sqlite3 binding je electron-ABI) →
// plný sync obou DB (~7 min, ~580 requestů) → gzip (~140 MB → ~40 MB).
//
// Volá se před `electron-builder` (dist skripty) a v mac CI. Když je hotový
// seed mladší než SEED_MAX_AGE, přeskočí se — běžné buildy tak nečekají;
// při release se prostě nechá vygenerovat čerstvý (nebo smazat a spustit).

/* eslint-disable no-console */
const { execFileSync } = require('child_process')
const {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync
} = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')
const { createGzip } = require('zlib')
const { pipeline } = require('stream/promises')

const APP = join(__dirname, '..')
const OUT_GZ = join(__dirname, 'catalog-seed.db.gz')
/** Jak starý seed ještě neregenerovat (delta v appce novinky stejně dožene). */
const SEED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

async function main() {
  if (existsSync(OUT_GZ) && Date.now() - statSync(OUT_GZ).mtimeMs < SEED_MAX_AGE_MS) {
    const mb = (statSync(OUT_GZ).size / 1024 / 1024).toFixed(1)
    console.log(`[seed] fresh enough (${mb} MB), skipping regeneration`)
    return
  }

  const work = mkdtempSync(join(tmpdir(), 'chm-seed-'))
  // Bundle MUSÍ ležet uvnitř app složky — require('better-sqlite3') se
  // resolvuje od umístění skriptu, ne od cwd (z temp složky by ho nenašel).
  const bundle = join(APP, '.seedgen.tmp.cjs')
  const db = join(work, 'catalog-seed.db')
  try {
    console.log('[seed] bundling seedgen…')
    // esbuild přes JS API — spouštění .cmd přes shell rozbíjí cesta s mezerami.
    const esbuild = require(join(APP, 'node_modules', 'esbuild'))
    esbuild.buildSync({
      entryPoints: [join(APP, 'src', 'main', 'tools', 'seedgen.ts')],
      bundle: true,
      platform: 'node',
      external: ['better-sqlite3'],
      outfile: bundle,
      logLevel: 'error'
    })

    console.log('[seed] running full sync under Electron runtime…')
    const electron = require(join(APP, 'node_modules', 'electron')) // cesta k binárce
    execFileSync(electron, [bundle], {
      cwd: APP, // require('better-sqlite3') se resolvuje z app node_modules
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SEED_OUT: db }
    })

    console.log('[seed] gzipping…')
    await pipeline(createReadStream(db), createGzip({ level: 9 }), createWriteStream(OUT_GZ))
    const raw = (statSync(db).size / 1024 / 1024).toFixed(1)
    const gz = (statSync(OUT_GZ).size / 1024 / 1024).toFixed(1)
    console.log(`[seed] done: ${raw} MB -> ${gz} MB (${OUT_GZ})`)
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(bundle, { force: true })
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err)
  process.exit(1)
})
