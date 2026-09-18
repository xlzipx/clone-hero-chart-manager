// Detekce běžících rhythm her (Clone Hero + YARG) — jejich spuštění a focus restore.
//
// Windows: plná podpora CH i YARG (tasklist / PowerShell SetForegroundWindow).
// macOS:   plná podpora CH i YARG (open / pgrep / osascript). YARG má oficiální
//          macOS universal build (přes YARC Launcher).
// Linux:   Oba mají oficiální nativní build. YARG (YARC Launcher, ELF `YARG` /
//          `YARG.x86_64`) i Clone Hero (`Linux.x86_64-Standalone.tar` z
//          clonehero.net, ELF `CloneHero.x86_64`; případně Flathub balíček
//          `net.clonehero.CloneHero`). Detekce běhu čtením `/proc/<pid>/cmdline`
//          (case-insensitive podřetězce „clonehero" / „yarg" napříč wrappery /
//          Wine / Proton / Flatpak). Focus restore přes `wmctrl` → `xdotool`
//          (best-effort — když ani jedno není, jen launch).

import { exec, execFile, spawn } from 'child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { getConfig } from './config'
import { cleanChildEnv, isLinux, isMac, isWin } from './platform'
import { errMsg } from '../../shared/errors'

const execAsync = promisify(exec)

/** Známé jména procesů pro každou hru (mohou se v budoucnu rozšířit). */
const PROC_CH = 'Clone Hero.exe'
const PROC_YARG = 'YARG.exe'
/** Jména procesů uvnitř .app bundlu na macOS (Contents/MacOS/<name>). */
const PROC_CH_MAC = 'Clone Hero'
const PROC_YARG_MAC = 'YARG'

export type GameId = 'clone-hero' | 'yarg'
export type RunningGame = GameId | null

// ─────────────────────────────────────────────────────────────────────
// Auto‑detekce cest k hernímu artefaktu
// ─────────────────────────────────────────────────────────────────────

/** macOS: standardní umístění Clone Hero.app. */
function macChAppCandidates(): string[] {
  const home = homedir()
  return [
    '/Applications/Clone Hero.app',
    join(home, 'Applications', 'Clone Hero.app'),
    join(home, 'Clone Hero', 'Clone Hero.app'), // rozložení jako na Windows
    join(home, 'Downloads', 'Clone Hero.app')
  ]
}

/**
 * macOS: najde `.app` bundle daného jména pod kořeny do hloubky `maxDepth`.
 * Do jiných `.app` bundlů nesestupujeme (obsahují spoustu podsložek). Slouží
 * hlavně k dohledání YARG.app, který YARC Launcher instaluje do vnořené složky.
 */
function findAppBundle(roots: string[], appName: string, maxDepth: number): string | null {
  const walk = (dir: string, depth: number): string | null => {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name === appName) return join(dir, e.name)
    }
    if (depth >= maxDepth) return null
    for (const e of entries) {
      if (e.isDirectory() && !e.name.endsWith('.app')) {
        const hit = walk(join(dir, e.name), depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  for (const root of roots) {
    if (!existsSync(root)) continue
    const hit = walk(root, 0)
    if (hit) return hit
  }
  return null
}

/**
 * Linux: rekurzivně hledá první existující soubor daného jména pod `root`.
 * Používá se pro YARG binárku (`YARG.x86_64` / `YARG`), kterou YARC Launcher
 * schovává do vnořených složek s verzí.
 */
function findElfBinary(root: string, names: string[], maxDepth: number): string | null {
  const walk = (dir: string, depth: number): string | null => {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries) {
      if (e.isFile() && names.includes(e.name)) return join(dir, e.name)
    }
    if (depth >= maxDepth) return null
    for (const e of entries) {
      if (e.isDirectory()) {
        const hit = walk(join(dir, e.name), depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(root, 0)
}

/**
 * Vrátí cestu ke spustitelnému Clone Hero artefaktu (manuální override z configu
 * má přednost). Na Windows je to `Clone Hero.exe`, na macOS `Clone Hero.app`.
 */
export function detectChExe(): string | null {
  const cfg = getConfig()
  if (cfg.chExePath && existsSync(cfg.chExePath)) return cfg.chExePath

  if (isMac) {
    for (const p of macChAppCandidates()) if (existsSync(p)) return p
    return null
  }

  if (isLinux) {
    // CH má oficiální nativní Linux build (`Linux.x86_64-Standalone.tar` z
    // clonehero.net) — Unity binárka jmenem `CloneHero.x86_64`. Podíváme se
    // vedle Songs složky (typické rozložení: `~/Clone Hero/Songs` a vedle
    // `CloneHero.x86_64`), do běžných domácích cest a k Flathub sandbox exportu.
    const home = homedir()
    if (cfg.songsDir) {
      const parent = dirname(cfg.songsDir)
      const candidate = join(parent, 'CloneHero.x86_64')
      if (existsSync(candidate)) return candidate
    }
    const linuxCandidates = [
      // Default nativního tar buildu (skrytá `.clonehero/` v home).
      join(home, '.clonehero', 'CloneHero.x86_64'),
      // Viditelné rozbalení tar souboru — různé konvence.
      join(home, 'Clone Hero', 'CloneHero.x86_64'),
      join(home, 'clonehero', 'CloneHero.x86_64'),
      join(home, 'Games', 'Clone Hero', 'CloneHero.x86_64'),
      join(home, '.local', 'share', 'Clone Hero', 'CloneHero.x86_64'),
      // Flatpak (`net.clonehero.CloneHero`) — detekuje instalaci; přímý spawn
      // ale sandboxem omezený, Flatpak uživatel radši nastaví `flatpak run`
      // wrapper skript v Settings.
      join(home, '.local', 'share', 'flatpak', 'app', 'net.clonehero.CloneHero', 'current', 'active', 'files', 'CloneHero.x86_64'),
      join(home, '.local', 'share', 'flatpak', 'app', 'net.clonehero.CloneHero', 'current', 'active', 'files', 'bin', 'CloneHero.x86_64'),
      '/var/lib/flatpak/app/net.clonehero.CloneHero/current/active/files/CloneHero.x86_64',
      '/var/lib/flatpak/app/net.clonehero.CloneHero/current/active/files/bin/CloneHero.x86_64'
    ]
    for (const p of linuxCandidates) if (existsSync(p)) return p
    return null
  }

  // Windows.
  if (cfg.songsDir) {
    const candidate = join(dirname(cfg.songsDir), 'Clone Hero.exe')
    if (existsSync(candidate)) return candidate
  }
  for (const p of [
    'G:\\Clone Hero\\Clone Hero.exe',
    'C:\\Program Files\\Clone Hero\\Clone Hero.exe',
    'C:\\Program Files (x86)\\Clone Hero\\Clone Hero.exe',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clone Hero\\Clone Hero.exe',
    'C:\\Clone Hero\\Clone Hero.exe'
  ]) {
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Vrátí cestu ke spustitelnému YARG artefaktu (manuální override má přednost).
 *
 * Windows: `YARG.exe` — launcher rozbaluje verze do náhodně pojmenovaných GUID
 *   složek pod `…/YARG Installs/<GUID>/installation/YARG.exe`.
 * macOS: `YARG.app` — buď v /Applications, nebo (přes YARC Launcher) vnořené
 *   pod `~/Library/Application Support/YARC/…`.
 */
export function detectYargExe(): string | null {
  const cfg = getConfig()
  if (cfg.yargExePath && existsSync(cfg.yargExePath)) return cfg.yargExePath

  if (isMac) {
    const home = homedir()
    for (const p of [
      '/Applications/YARG.app',
      join(home, 'Applications', 'YARG.app'),
      join(home, 'Downloads', 'YARG.app')
    ]) {
      if (existsSync(p)) return p
    }
    // YARC Launcher instaluje YARG do vnořené složky v Application Support.
    return findAppBundle(
      [
        join(home, 'Library', 'Application Support', 'YARC'),
        join(home, 'Library', 'Application Support', 'YARC Launcher'),
        join(home, 'Library', 'Application Support', 'in.yarg.launcher')
      ],
      'YARG.app',
      5
    )
  }

  if (isLinux) {
    // YARG má oficiální Linux build (Unity, ELF binárka). Uživatel ho obvykle
    // stáhne přes YARC Launcher; hledáme v běžných místech, jméno spustitelného
    // souboru se může lišit mezi verzemi (`YARG.x86_64` nebo `YARG`).
    const home = homedir()
    const linuxRoots = [
      join(home, 'YARG'),
      join(home, '.local', 'share', 'YARG'),
      join(home, '.local', 'share', 'YARC'),
      join(home, '.local', 'share', 'YARC Launcher'),
      join(home, '.local', 'share', 'in.yarg.launcher'),
      join(home, 'Downloads', 'YARG')
    ]
    for (const root of linuxRoots) {
      if (!existsSync(root)) continue
      // Do hloubky 4: launcher často dělá vnořené GUID/version složky.
      const hit = findElfBinary(root, ['YARG.x86_64', 'YARG'], 4)
      if (hit) return hit
    }
    return null
  }

  if (!isWin) return null

  const rootCandidates = [
    'G:\\YARG\\Content\\YARG Installs',
    'C:\\YARG\\Content\\YARG Installs',
    `${process.env.LOCALAPPDATA || 'C:\\Users\\Public\\AppData\\Local'}\\YARG\\Content\\YARG Installs`,
    `${process.env.LOCALAPPDATA || 'C:\\Users\\Public\\AppData\\Local'}\\Programs\\YARG\\Content\\YARG Installs`,
    'C:\\Program Files\\YARG\\Content\\YARG Installs'
  ]

  for (const root of rootCandidates) {
    if (!existsSync(root)) continue
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    // Najdi nejnovější GUID složku (podle mtime), ve které je installation/YARG.exe.
    const candidates: { path: string; mtime: number }[] = []
    for (const guid of entries) {
      const exe = join(root, guid, 'installation', 'YARG.exe')
      if (existsSync(exe)) {
        try {
          candidates.push({ path: exe, mtime: statSync(exe).mtimeMs })
        } catch {
          /* ignore */
        }
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.mtime - a.mtime)
      return candidates[0].path
    }
  }

  return null
}

/** Status detekce CH.exe — pro UI rozhodnutí o zobrazení pole. */
export function chExeStatus(): { path: string | null; autoDetected: boolean } {
  const cfg = getConfig()
  if (cfg.chExePath && existsSync(cfg.chExePath)) {
    return { path: cfg.chExePath, autoDetected: false }
  }
  const auto = detectChExe()
  return { path: auto, autoDetected: auto !== null }
}

/** Status detekce YARG.exe — analogicky jako CH. */
export function yargExeStatus(): { path: string | null; autoDetected: boolean } {
  const cfg = getConfig()
  if (cfg.yargExePath && existsSync(cfg.yargExePath)) {
    return { path: cfg.yargExePath, autoDetected: false }
  }
  const auto = detectYargExe()
  return { path: auto, autoDetected: auto !== null }
}

// ─────────────────────────────────────────────────────────────────────
// Detekce běhu
// ─────────────────────────────────────────────────────────────────────

/** Kterou hru aktuálně běží (nebo null). Když by běžely obě, preferujeme CH. */
export async function runningGame(): Promise<RunningGame> {
  if (isMac) return runningGameMac()
  if (isWin) return runningGameWin()
  if (isLinux) return runningGameLinux()
  return null
}

async function runningGameLinux(): Promise<RunningGame> {
  // Nechodíme přes `pgrep` ani přes přesné jméno procesu — na Linuxu se název
  // binárky, obalovací skripty, Wine/Proton wrappery i Flatpak spouštěče hodně
  // liší. Scanujeme `/proc/<pid>/cmdline` přímo přes fs (nejspolehlivější napříč
  // distribucemi; funguje i z AppImage) a v CELÉM příkazovém řádku hledáme
  // case-insensitive podřetězce. NUL bajty (oddělovače argv) nahradíme mezerami,
  // pak mezery zahodíme úplně, aby stejný podřetězec „clonehero" trefil:
  //   • Unity binárku       `CloneHero.x86_64`  (bez mezery)
  //   • Wine/Proton         `Clone Hero.exe`    (s mezerou)
  //   • Flatpak app-id      `net.clonehero.CloneHero`
  // a „yarg" trefí `YARG.x86_64`, `YARG`, i launcher-spouštěné varianty.
  //
  // Vlastní procesní strom CHM (Electron main + renderer/gpu/utility/zygote)
  // MUSÍME vyloučit — jinak by náš productName „Clone Hero Chart Manager" dělal
  // false positive. Vyloučíme ho spolehlivě porovnáním cíle symlinku
  // `/proc/<pid>/exe` s naším vlastním (všechny naše subprocesy sdílejí tutéž
  // binárku); jako pojistka navíc přeskočíme cokoli s „chartmanager" v cmdline.
  let ownExe = ''
  try {
    ownExe = readlinkSync('/proc/self/exe')
  } catch {
    /* nejde přečíst → spolehneme se na „chartmanager" pojistku níž */
  }

  let entries: string[]
  try {
    entries = readdirSync('/proc')
  } catch {
    return null
  }

  let chFound = false
  let yargFound = false
  for (const name of entries) {
    // /proc obsahuje spoustu nečíselných entries (self, sys, meminfo, …).
    if (!/^\d+$/.test(name)) continue

    // Vyluč celý náš vlastní procesní strom (stejná binárka jako my).
    if (ownExe) {
      try {
        if (readlinkSync(`/proc/${name}/exe`) === ownExe) continue
      } catch {
        /* exe cizích procesů nepřečteme (EACCES/ENOENT) — pak to nejsme my */
      }
    }

    let cmdline: string
    try {
      cmdline = readFileSync(`/proc/${name}/cmdline`, 'utf8')
    } catch {
      continue // proces zmizel za běhu / EACCES
    }
    if (!cmdline) continue

    // NUL → mezera, lowercase, pak zahodit VŠECHNY mezery (viz komentář výše).
    const flat = cmdline.replace(/\0/g, ' ').toLowerCase().replace(/\s+/g, '')

    // Pojistka proti false-positivu z vlastní appky (productName obsahuje
    // „clone hero"), kdyby selhalo čtení exe symlinku výše.
    if (flat.includes('chartmanager')) continue

    if (!chFound && flat.includes('clonehero')) {
      chFound = true
      if (yargFound) break
    } else if (!yargFound && flat.includes('yarg')) {
      yargFound = true
      if (chFound) break
    }
  }

  // Když by běžely obě, preferujeme CH (dokumentované chování).
  if (chFound) return 'clone-hero'
  if (yargFound) return 'yarg'
  return null
}

async function runningGameWin(): Promise<RunningGame> {
  try {
    // Jeden tasklist call → vrátí všechny procesy s daným IMAGENAME. Voláme
    // postupně, ale s timeoutem 2 s každé.
    const { stdout: chOut } = await execAsync(
      `tasklist /NH /FO CSV /FI "IMAGENAME eq ${PROC_CH}"`,
      { windowsHide: true, timeout: 2500 }
    )
    if (chOut.toLowerCase().includes(PROC_CH.toLowerCase())) return 'clone-hero'

    const { stdout: yOut } = await execAsync(
      `tasklist /NH /FO CSV /FI "IMAGENAME eq ${PROC_YARG}"`,
      { windowsHide: true, timeout: 2500 }
    )
    if (yOut.toLowerCase().includes(PROC_YARG.toLowerCase())) return 'yarg'

    return null
  } catch {
    return null
  }
}

async function runningGameMac(): Promise<RunningGame> {
  // pgrep -x: přesná shoda jména procesu. Vrátí exit 1 když nic nenajde →
  // promisify(exec) to hodí jako reject, takže chytneme v catch. CH má přednost.
  try {
    await execAsync(`pgrep -x "${PROC_CH_MAC}"`, { timeout: 2500 })
    return 'clone-hero'
  } catch {
    /* CH neběží — zkus YARG */
  }
  try {
    await execAsync(`pgrep -x "${PROC_YARG_MAC}"`, { timeout: 2500 })
    return 'yarg'
  } catch {
    return null
  }
}

/** Zachování staré API pro zpětnou kompatibilitu (boolean). */
export async function isGameRunning(): Promise<boolean> {
  return (await runningGame()) !== null
}

// ─────────────────────────────────────────────────────────────────────
// Spuštění / focus restore
// ─────────────────────────────────────────────────────────────────────


/** Spustí Clone Hero (detach), aby app nečekala. */
export function launchGame(): { ok: true } | { ok: false; error: string } {
  const exe = detectChExe()
  if (!exe) {
    return {
      ok: false,
      error: isMac
        ? "Couldn't find Clone Hero.app. Install it to /Applications or set the path in Settings."
        : isLinux
          ? "Couldn't find CloneHero.x86_64. Install Clone Hero from clonehero.net (extract Linux.x86_64-Standalone.tar) or Flathub, and set the path in Settings if it's in a non‑default location."
          : "Couldn't find Clone Hero.exe. Set the correct Songs folder in Settings (Clone Hero.exe is its parent)."
    }
  }
  try {
    if (isMac) {
      // `open` vrátí hned, hru spustí odděleně — přesně to chceme (detach).
      const child = spawn('open', ['-a', exe], { detached: true, stdio: 'ignore' })
      child.unref()
      return { ok: true }
    }
    const child = spawn(exe, [], {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: cleanChildEnv() // Linux: očistí AppImage env, aby hra nastartovala
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

/** Spustí YARG (detach). Windows / macOS / Linux. */
export function launchYarg(): { ok: true } | { ok: false; error: string } {
  const exe = detectYargExe()
  if (!exe) {
    return {
      ok: false,
      error: isMac
        ? "Couldn't find YARG.app. Install YARG via the YARC Launcher, or set the path in Settings."
        : isLinux
          ? "Couldn't find the YARG Linux binary. Install YARG via the YARC Launcher, or set the path in Settings (typically YARG.x86_64 inside its install folder)."
          : "Couldn't find YARG.exe. Set the path manually in Settings — typically at G:\\YARG\\Content\\YARG Installs\\<GUID>\\installation\\YARG.exe."
    }
  }
  try {
    if (isMac) {
      const child = spawn('open', ['-a', exe], { detached: true, stdio: 'ignore' })
      child.unref()
      return { ok: true }
    }
    const child = spawn(exe, [], {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: cleanChildEnv() // Linux: očistí AppImage env, aby hra nastartovala
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

/**
 * Přepne aktuálně běžící hru do popředí. Pokud žádná neběží a CH je detekováno,
 * spustí CH. `prefer` vynutí focus konkrétní hry (např. po stažení).
 */
export async function bringGameToFront(
  prefer?: GameId
): Promise<{ ok: true; game?: GameId } | { ok: false; error: string }> {
  if (!isWin && !isMac && !isLinux) {
    return { ok: false, error: 'Unsupported platform.' }
  }

  // Pokud máme preferenci a ta hra běží, použij ji; jinak co aktuálně běží.
  let target: GameId | null = null
  const running = await runningGame()
  if (prefer && running === prefer) target = prefer
  else if (running) target = running

  if (!target) {
    // Žádná neběží → spusť preferovanou (CH default).
    if (prefer === 'yarg') return launchYarg()
    return launchGame()
  }

  if (isLinux) {
    // Focus restore přes okenní titulek (Unity nastavuje productName „Clone
    // Hero" / „YARG"). POZOR na kolizi: `wmctrl -a 'Clone Hero'` matchuje
    // titulek jako PODŘETĚZEC a náš vlastní titulek je „Clone Hero Chart
    // Manager" → aktivovalo by NÁS, ne hru (u YARG kolize není, proto ten
    // fungoval). Proto hledáme konkrétní window id přes `wmctrl -l` a u CH
    // vyloučíme „Chart Manager". Fallback na `xdotool` (se stejným vyloučením).
    // Nic z toho není fatální — hra běží dál, uživatel si ji přepne z panelu.
    // (Pozn.: na čistém Waylandu wmctrl/xdotool okno neaktivují — bezpečnostní
    // omezení kompozitoru; funguje pod X11 / XWayland, kde hry běží jako X klient.)
    const script =
      target === 'yarg'
        ? `
id=$(wmctrl -l 2>/dev/null | grep -i 'yarg' | head -n1 | cut -d' ' -f1)
if [ -n "$id" ]; then wmctrl -i -a "$id"; exit $?; fi
xdotool search --name 'YARG' 2>/dev/null | head -n1 | xargs -r xdotool windowactivate
`
        : `
id=$(wmctrl -l 2>/dev/null | grep -i 'clone hero' | grep -vi 'chart manager' | head -n1 | cut -d' ' -f1)
if [ -n "$id" ]; then wmctrl -i -a "$id"; exit $?; fi
for w in $(xdotool search --name 'Clone Hero' 2>/dev/null); do
  n=$(xdotool getwindowname "$w" 2>/dev/null)
  case "$n" in
    *"Chart Manager"*) : ;;
    *) xdotool windowactivate "$w"; exit 0 ;;
  esac
done
exit 1
`
    return new Promise((resolve) => {
      execFile('sh', ['-c', script], { timeout: 4000 }, () => {
        // Neúspěch fokusu není chyba — hra běží, jen se nepovedlo přepnout.
        resolve({ ok: true, game: target as GameId })
      })
    })
  }

  if (isMac) {
    const appName = target === 'yarg' ? PROC_YARG_MAC : PROC_CH_MAC
    return new Promise((resolve) => {
      execFile(
        'osascript',
        ['-e', `tell application "${appName}" to activate`],
        { timeout: 4000 },
        (err) => {
          if (err) resolve({ ok: false, error: err.message })
          else resolve({ ok: true, game: target as GameId })
        }
      )
    })
  }

  // Windows: Add-Type definuje Win32 wrappery; ShowWindow(9) = SW_RESTORE.
  const procName = target === 'yarg' ? 'YARG' : 'Clone Hero'
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Name W -Namespace U -MemberDefinition '
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int n);
' | Out-Null
$p = Get-Process -Name '${procName}' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  [U.W]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
  [U.W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
}
`.trim()

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 4000 },
      (err) => {
        if (err) resolve({ ok: false, error: err.message })
        else resolve({ ok: true, game: target as GameId })
      }
    )
  })
}
