// Jednoduché perzistentní nastavení v JSON souboru v userData.

import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AppConfig } from '../../shared/types'

let cached: AppConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/**
 * Kořenové adresáře, vedle kterých hledáme přibalené nástroje (onyx, 7z) i hru.
 * U portable .exe je `PORTABLE_EXECUTABLE_DIR` složka, kam uživatel exe rozbalil.
 */
function rootCandidates(): string[] {
  const roots: string[] = []
  // Nainstalovaná appka: přibalené nástroje jsou v resources/ (onyx, tools).
  if (process.resourcesPath) roots.push(process.resourcesPath)
  if (process.env.PORTABLE_EXECUTABLE_DIR) roots.push(process.env.PORTABLE_EXECUTABLE_DIR)
  try {
    roots.push(dirname(app.getPath('exe')))
  } catch {
    /* ignore */
  }
  roots.push(process.cwd())
  // Vývoj: <project>/app → přidej kořen projektu.
  roots.push(dirname(process.cwd()))
  return [...new Set(roots)]
}

/** Najde soubor podle názvu pod danými kořeny do hloubky `maxDepth`. */
function findFile(roots: string[], fileName: string, maxDepth: number): string | null {
  const lower = fileName.toLowerCase()
  const walk = (dir: string, depth: number): string | null => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return null
    }
    // nejdřív soubory v tomto adresáři
    for (const name of entries) {
      if (name.toLowerCase() === lower) {
        const full = join(dir, name)
        try {
          if (statSync(full).isFile()) return full
        } catch {
          /* ignore */
        }
      }
    }
    if (depth >= maxDepth) return null
    for (const name of entries) {
      const full = join(dir, name)
      try {
        if (statSync(full).isDirectory()) {
          const hit = walk(full, depth + 1)
          if (hit) return hit
        }
      } catch {
        /* ignore */
      }
    }
    return null
  }
  for (const root of roots) {
    const hit = walk(root, 0)
    if (hit) return hit
  }
  return null
}

/** Zkusí najít složku hry Clone Hero a vrátí cestu k jejímu Songs adresáři. */
function detectSongsDir(): string {
  const fallback = 'G:\\Clone Hero\\Songs'
  const candidates: string[] = []
  for (const start of rootCandidates()) {
    let dir = start
    for (let i = 0; i < 4; i++) {
      candidates.push(dir)
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, 'Clone Hero.exe'))) return join(dir, 'Songs')
    if (existsSync(join(dir, 'Clone Hero_Data')) && existsSync(join(dir, 'Songs'))) {
      return join(dir, 'Songs')
    }
  }
  return fallback
}

/** Najde přibalené onyx.exe (vedle exe ve složce `onyx`), nebo dev cestu. */
function detectOnyxPath(): string {
  const roots = [
    ...rootCandidates().map((r) => join(r, 'onyx')),
    ...rootCandidates().map((r) => join(r, 'native', 'onyx'))
  ]
  return findFile(roots, 'onyx.exe', 3) ?? ''
}

/** Najde složku se 7z.exe (vedle exe ve složce `tools`), nebo dev C3 bin. */
function detect7zDir(): string {
  const roots = [
    ...rootCandidates().map((r) => join(r, 'tools')),
    ...rootCandidates().map((r) => join(r, 'native', '7zip')),
    ...rootCandidates().map((r) => join(r, 'C3 CON TOOLS', 'bin')),
    ...rootCandidates()
  ]
  const hit = findFile(roots, '7z.exe', 2)
  return hit ? dirname(hit) : ''
}

function defaults(): AppConfig {
  return {
    songsDir: detectSongsDir(),
    c3BinDir: detect7zDir(),
    onyxPath: detectOnyxPath(),
    chExePath: '', // auto-detekce z songsDir
    yargExePath: '', // auto-detekce v běžných YARG instalech
    recordsPerPage: 25,
    hotkeys: {
      // Show / hide window — Ctrl+I (rychlý "Insert/Invoke" toggle, ergonomický
      // pro pravou ruku na klávesnici; nepřekrývá běžné herní bindings v CH).
      toggleOverlay: 'Control+I'
    },
    showReminder: false, // opt-in
    reminderPosition: 'bottom-right'
  }
}

export function getConfig(): AppConfig {
  if (cached) return cached
  const def = defaults()
  let result: AppConfig
  try {
    const raw = readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    result = { ...def, ...parsed, hotkeys: { ...def.hotkeys, ...parsed.hotkeys } }
    // Nástroje (onyx, 7z) jsou přibalené → přibalená/detekovaná cesta má VŽDY
    // přednost před uloženou (jinak by stará cesta na 7-Zip 9.20 přebíjela
    // moderní 7-Zip). Uloženou cestu použijeme jen když detekce selže.
    if (def.onyxPath) result.onyxPath = def.onyxPath
    if (def.c3BinDir) result.c3BinDir = def.c3BinDir
  } catch {
    result = def
  }
  cached = result
  return result
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const current = getConfig()
  const next: AppConfig = {
    ...current,
    ...patch,
    hotkeys: { ...current.hotkeys, ...(patch.hotkeys ?? {}) }
  }
  cached = next
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
