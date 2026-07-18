// Centrální abstrakce OS specifik. Cílem je držet `process.platform` větvení na
// jednom místě: jména přibalených binárek (onyx, 7-Zip), jména herních procesů
// a app bundlů se liší mezi Windows a macOS. Zbytek kódu se ptá tady, ne na
// `process.platform` roztroušeně.

import { chmodSync, statSync } from 'fs'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

/**
 * Zajistí, že přibalená binárka je spustitelná. Na Windows no-op. Na macOS/Linux
 * přibalené soubory (extraResources) často ztratí execute bit → `spawn` pak spadne
 * s EACCES. Idempotentní a best-effort — když chmod selže, necháme spawn ať vrátí
 * svou vlastní chybu.
 */
export function ensureExecutable(binPath: string): void {
  if (isWin) return
  try {
    const mode = statSync(binPath).mode
    if ((mode & 0o111) === 0) chmodSync(binPath, mode | 0o755)
  } catch {
    /* best-effort — spawn nahlásí případný problém sám */
  }
}

/** Jméno přibalené Onyx binárky (konvertor RB CON). */
export function onyxBinaryName(): string {
  // Windows: onyx.exe; macOS/Linux: onyx (mach-o / ELF, bez přípony).
  return isWin ? 'onyx.exe' : 'onyx'
}

/** Jméno 7-Zip CLI binárky. */
export function sevenZipBinaryName(): string {
  // Windows používá 7z.exe (+ 7z.dll). macOS/Linux distribuce má samostatný
  // statický `7zz` (7-Zip 21+), který nepotřebuje doprovodné DLL.
  return isWin ? '7z.exe' : '7zz'
}

/**
 * Jméno Clone Hero spustitelného artefaktu, podle kterého detekujeme instalaci
 * hry vedle Songs složky.
 *   - Windows: `Clone Hero.exe`
 *   - macOS:   `Clone Hero.app` (bundle, ne soubor)
 */
export function cloneHeroArtifactName(): string {
  return isMac ? 'Clone Hero.app' : 'Clone Hero.exe'
}
