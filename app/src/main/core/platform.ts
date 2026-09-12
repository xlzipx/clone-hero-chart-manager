// Centrální abstrakce OS specifik. Cílem je držet `process.platform` větvení na
// jednom místě: jména přibalených binárek (onyx, 7-Zip), jména herních procesů
// a app bundlů se liší mezi Windows, macOS a Linuxem. Zbytek kódu se ptá tady,
// ne na `process.platform` roztroušeně.

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

/**
 * Env pro dětský proces spuštěný z Linuxu — když sami běžíme jako AppImage,
 * runtime nám nastavuje spoustu proměnných (LD_LIBRARY_PATH, GTK_PATH,
 * XDG_DATA_DIRS, …) na cesty UVNITŘ AppImage. Když je zdědí dítě (hra, onyx,
 * 7zz), pokusí se loadovat naše zabalené knihovny místo systémových a spadne.
 * Odstraní se známé „nakažené" klíče; když AppImage uložil originál pod
 * `APPIMAGE_ORIGINAL_*`, obnoví se z něj hodnota, aby dítě dostalo prostředí
 * jako z běžné shellu. Na Windows/macOS vrací původní `process.env` (no-op).
 */
export function cleanChildEnv(): NodeJS.ProcessEnv {
  if (!isLinux) return process.env
  const env: NodeJS.ProcessEnv = { ...process.env }
  const KILL = [
    'APPDIR', 'APPIMAGE', 'ARGV0', 'OWD',
    'LD_LIBRARY_PATH', 'LD_PRELOAD', 'LD_AUDIT',
    'GTK_PATH', 'GTK_EXE_PREFIX', 'GTK_DATA_PREFIX',
    'GIO_MODULE_DIR', 'GIO_EXTRA_MODULES',
    'GDK_PIXBUF_MODULE_FILE', 'GDK_PIXBUF_MODULEDIR',
    'GST_PLUGIN_PATH', 'GST_PLUGIN_SYSTEM_PATH', 'GST_PLUGIN_SYSTEM_PATH_1_0',
    'GST_PLUGIN_SCANNER',
    'QT_PLUGIN_PATH', 'QT_QPA_PLATFORM_PLUGIN_PATH',
    'FONTCONFIG_PATH', 'FONTCONFIG_FILE',
    'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS',
    'PYTHONHOME', 'PYTHONPATH', 'PERLLIB', 'PERL5LIB',
    'LOCPATH', 'PIXBUF_LOADERS_CACHE'
  ]
  for (const k of KILL) delete env[k]
  // Obnov originály, které si AppImage runtime schoval, aby dítě dostalo
  // původní shell env (pokud existuje).
  for (const k of Object.keys(process.env)) {
    const m = /^APPIMAGE_ORIGINAL_(.+)$/.exec(k)
    if (m && process.env[k] !== undefined) env[m[1]] = process.env[k]
  }
  return env
}
