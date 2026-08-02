// Stáhne prebuilt binding better-sqlite3 pro ELECTRON ABI (postinstall).
//
// Proč ne `electron-builder install-app-deps`: ten jede přes node-gyp rebuild
// ze zdrojáků, což vyžaduje VS Build Tools / Xcode — na čistém stroji spadne.
// better-sqlite3 přitom publikuje hotové prebuildy pro Electron (win-x64 i
// darwin-arm64), stačí si říct o správný runtime+target. V build configu je
// proto `npmRebuild: false` a binding obstarává tenhle skript.
//
// Selhání není fatální, pokud binding už existuje (např. offline reinstall).

const { execFileSync } = require('child_process')
const { existsSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const moduleDir = join(root, 'node_modules', 'better-sqlite3')
const binding = join(moduleDir, 'build', 'Release', 'better_sqlite3.node')

function electronVersion() {
  return require(join(root, 'node_modules', 'electron', 'package.json')).version
}

try {
  const target = electronVersion()
  // prebuild-install je závislost better-sqlite3 → resolvuj z jeho kontextu.
  const bin = require.resolve('prebuild-install/bin.js', { paths: [moduleDir, root] })
  execFileSync(
    process.execPath,
    [bin, '--runtime=electron', `--target=${target}`, `--arch=${process.arch}`, '--force'],
    { cwd: moduleDir, stdio: 'inherit' }
  )
  console.log(`[sqlite-prebuild] OK: electron ${target} ${process.platform}-${process.arch}`)
} catch (err) {
  if (existsSync(binding)) {
    console.warn('[sqlite-prebuild] fetch failed, keeping existing binding:', err.message)
  } else {
    console.error('[sqlite-prebuild] FAILED and no binding present:', err.message)
    process.exit(1)
  }
}
