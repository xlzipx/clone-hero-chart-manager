// electron-builder afterPack hook — ad-hoc podpis macOS buildu.
//
// Nemáme Apple Developer certifikát, takže .app nepodepisujeme "pořádně".
// Jenže na Apple Silicon (arm64) musí mít KAŽDÁ spustitelná binárka aspoň
// ad-hoc podpis, jinak ji kernel odmítne spustit. Bez něj macOS u staženého
// buildu hlásí "Aplikace je poškozena a nelze ji otevřít" — což nevypadá jako
// chybějící podpis, ale jako rozbitý soubor.
//
// electron-builder podpis přeskakuje (identity: null), takže si ho uděláme sami
// hned po zabalení .app a ještě před tím, než se z něj vyrobí .dmg.
//
// Po tomhle Gatekeeper u staženého buildu pořád hlásí "neznámý vývojář"
// (aplikace není notarizovaná) — to je očekávané a řeší se right-click > Open.

const { execFileSync } = require('child_process')
const { join } = require('path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  // --deep podepíše i vnořené binárky (Electron helpery, onyx, 7zz).
  // --force přepíše podpisy, které Electronu zůstaly z jeho vlastního buildu a
  // které se rozbily tím, jak electron-builder aplikaci přejmenoval a doplnil.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], {
    stdio: 'inherit'
  })

  // Ověření, že podpis opravdu sedí — ať build spadne tady a ne až u uživatele.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })

  console.log(`  • ad-hoc signed  ${appPath}`)
}
