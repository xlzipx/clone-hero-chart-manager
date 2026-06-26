// Detekce běžících rhythm her (Clone Hero + YARG) — jejich spuštění a focus restore.
//
// Implementace je Windows-only (CH na Linuxu/macOS nemá oficiální build,
// YARG má Linux build, ale podpora multiplatform není v plánu).

import { exec, execFile, spawn } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { getConfig } from './config'

const execAsync = promisify(exec)

/** Známé jména procesů pro každou hru (mohou se v budoucnu rozšířit). */
const PROC_CH = 'Clone Hero.exe'
const PROC_YARG = 'YARG.exe'

export type GameId = 'clone-hero' | 'yarg'
export type RunningGame = GameId | null

// ─────────────────────────────────────────────────────────────────────
// Auto‑detekce cest k exe
// ─────────────────────────────────────────────────────────────────────

/** Vrátí cestu k Clone Hero.exe (manuální override z configu má přednost). */
export function detectChExe(): string | null {
  const cfg = getConfig()
  if (cfg.chExePath && existsSync(cfg.chExePath)) return cfg.chExePath
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
 * Vrátí cestu k YARG.exe.
 *
 * YARG launcher rozbaluje konkrétní verze do náhodně pojmenovaných GUID složek
 * pod `…/YARG Installs/<GUID>/installation/YARG.exe`. Hledáme:
 *  1) Manuální override.
 *  2) Sekání podle "YARG Installs" v rodičovských cestách Songs (jen v rare
 *     případě, ale neuškodí to).
 *  3) Známé root paths (G:\YARG\Content, C:\Users\<u>\AppData\Local\Programs\YARG,
 *     C:\Program Files\YARG, atd.) — pro každý hledáme nejnovější GUID/installation/YARG.exe.
 */
export function detectYargExe(): string | null {
  const cfg = getConfig()
  if (cfg.yargExePath && existsSync(cfg.yargExePath)) return cfg.yargExePath

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
  if (process.platform !== 'win32') return null
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

/** Zachování staré API pro zpětnou kompatibilitu (boolean). */
export async function isGameRunning(): Promise<boolean> {
  return (await runningGame()) !== null
}

// ─────────────────────────────────────────────────────────────────────
// Spuštění / focus restore
// ─────────────────────────────────────────────────────────────────────

/** Spustí Clone Hero.exe (detach), aby app nečekala. */
export function launchGame(): { ok: true } | { ok: false; error: string } {
  const exe = detectChExe()
  if (!exe) {
    return {
      ok: false,
      error:
        "Couldn't find Clone Hero.exe. Set the correct Songs folder in Settings (Clone Hero.exe is its parent)."
    }
  }
  try {
    const child = spawn(exe, [], {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Spustí YARG.exe (detach). */
export function launchYarg(): { ok: true } | { ok: false; error: string } {
  const exe = detectYargExe()
  if (!exe) {
    return {
      ok: false,
      error:
        "Couldn't find YARG.exe. Set the path manually in Settings — typically at G:\\YARG\\Content\\YARG Installs\\<GUID>\\installation\\YARG.exe."
    }
  }
  try {
    const child = spawn(exe, [], {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Přepne aktuálně běžící hru do popředí. Pokud žádná neběží a CH je detekováno,
 * spustí CH.
 *
 * Když uživatel explicitně chce focus konkrétní hry (např. po stažení), může
 * předat `prefer` parameter.
 */
export async function bringGameToFront(
  prefer?: GameId
): Promise<{ ok: true; game?: GameId } | { ok: false; error: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Only supported on Windows.' }
  }

  // Pokud máme preferenci a ta hra běží, použij ji; jinak co aktuálně běží.
  let target: GameId | null = null
  const running = await runningGame()
  if (prefer && running === prefer) target = prefer
  else if (running) target = running
  else if (prefer === 'yarg') target = null
  else target = null

  if (!target) {
    // Žádná neběží → spusť preferovanou (CH default).
    if (prefer === 'yarg') return launchYarg()
    return launchGame()
  }

  const procName = target === 'yarg' ? 'YARG' : 'Clone Hero'
  // Add-Type definuje Win32 wrappery; ShowWindow(9) = SW_RESTORE (z minimalizace).
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
