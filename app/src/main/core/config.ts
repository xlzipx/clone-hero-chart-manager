// Jednoduché perzistentní nastavení v JSON souboru v userData.

import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { DEFAULT_FOLDER_TEMPLATE } from '../../shared/foldertemplate'
import type { AppConfig } from '../../shared/types'
import { cloneHeroArtifactName, isLinux, isMac, onyxBinaryName, sevenZipBinaryName } from './platform'

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
  // macOS: Songs složka je v CH volitelná a lidé ji mají na různých místech.
  // Projdeme známé kandidáty a vrátíme první, který REÁLNĚ existuje; když nic,
  // padneme na viditelnou domovskou složku (ne skrytou v Library).
  if (isMac) {
    const home = homedir()
    const macCandidates = [
      join(home, 'Clone Hero', 'Songs'), // stejné rozložení jako Windows G:\Clone Hero\Songs
      join(home, 'Documents', 'Clone Hero', 'Songs'),
      join(home, 'Music', 'Clone Hero', 'Songs'),
      join(home, 'Downloads', 'Clone Hero', 'Songs'),
      join(home, 'Applications', 'Clone Hero', 'Songs'),
      // CH sem ukládá nastavení/skóre; někdy tu bývá i Songs.
      join(home, 'Library', 'Application Support', 'com.srylain.CloneHero', 'Songs')
    ]
    for (const c of macCandidates) if (existsSync(c)) return c
    return join(home, 'Clone Hero', 'Songs')
  }

  // Linux: CH má oficiální nativní build (`Linux.x86_64-Standalone.tar`), který
  // default ukládá do skryté `~/.clonehero/Songs/`. Kromě toho zkusíme běžné
  // viditelné složky (uživatel může tar rozbalit kamkoli) a Flatpak sandbox
  // export (`net.clonehero.CloneHero`).
  if (isLinux) {
    const home = homedir()
    const linuxCandidates = [
      // Default nativního CH tar buildu (skrytá složka).
      join(home, '.clonehero', 'Songs'),
      // Flatpak sandbox (net.clonehero.CloneHero) — data pod ~/.var/app/…
      join(home, '.var', 'app', 'net.clonehero.CloneHero', 'data', 'CloneHero', 'Songs'),
      join(home, '.var', 'app', 'net.clonehero.CloneHero', 'data', 'Songs'),
      // Uživatelské viditelné rozbalení tar souboru.
      join(home, 'Clone Hero', 'Songs'),
      join(home, 'Documents', 'Clone Hero', 'Songs'),
      join(home, 'Music', 'Clone Hero', 'Songs'),
      join(home, 'Downloads', 'Clone Hero', 'Songs'),
      join(home, '.local', 'share', 'Clone Hero', 'Songs')
    ]
    for (const c of linuxCandidates) if (existsSync(c)) return c
    return join(home, '.clonehero', 'Songs')
  }

  const fallback = 'G:\\Clone Hero\\Songs'
  const chArtifact = cloneHeroArtifactName() // 'Clone Hero.exe' na Windows
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
    if (existsSync(join(dir, chArtifact))) return join(dir, 'Songs')
    if (existsSync(join(dir, 'Clone Hero_Data')) && existsSync(join(dir, 'Songs'))) {
      return join(dir, 'Songs')
    }
  }
  return fallback
}

/** Najde přibalenou Onyx binárku (vedle exe ve složce `onyx`), nebo dev cestu. */
function detectOnyxPath(): string {
  const roots = [
    ...rootCandidates().map((r) => join(r, 'onyx')),
    ...rootCandidates().map((r) => join(r, 'native', 'onyx')),
    // macOS dev: rozbalený onyx-macos-x64 bundle.
    ...rootCandidates().map((r) => join(r, 'native', 'onyx-mac')),
    // Linux dev: extrahovaný obsah onyx-linux-x64.AppImage (squashfs-root).
    // Skutečná ELF binárka je uvnitř `usr/bin/onyx`, `findFile` ji najde do hloubky 5.
    ...rootCandidates().map((r) => join(r, 'native', 'onyx-linux'))
  ]
  // Hloubka 5: na macu je binárka uvnitř Onyx.app/Contents/MacOS/, a zip se může
  // rozbalit ještě do vnořené složky — ať to najdeme i tak.
  return findFile(roots, onyxBinaryName(), 5) ?? ''
}

/** Najde složku se 7-Zip CLI (vedle exe ve složce `tools`), nebo dev bin. */
function detect7zDir(): string {
  const roots = [
    ...rootCandidates().map((r) => join(r, 'tools')),
    ...rootCandidates().map((r) => join(r, 'native', '7zip')),
    ...rootCandidates().map((r) => join(r, 'native', '7zip-mac')),
    ...rootCandidates().map((r) => join(r, 'native', '7zip-linux')),
    ...rootCandidates().map((r) => join(r, 'C3 CON TOOLS', 'bin')),
    ...rootCandidates()
  ]
  const hit = findFile(roots, sevenZipBinaryName(), 2)
  return hit ? dirname(hit) : ''
}

function defaults(): AppConfig {
  return {
    songsDir: detectSongsDir(),
    c3BinDir: detect7zDir(),
    onyxPath: detectOnyxPath(),
    chExePath: '', // auto-detekce z songsDir
    yargExePath: '', // auto-detekce v běžných YARG instalech
    // Poslední volba databáze/systému + přepínačů v liště (obnoví se po restartu).
    database: 'rhythmverse',
    system: 'ch',
    hideOwned: false,
    directOnly: false,
    // Normalizace hlasitosti v přehrávači zapnutá — vyrovná pocitovou hlasitost
    // mezi skladbami konstantním gainem (dynamika zůstává). Uživatel může vypnout.
    normalizeLoudness: true,
    recordsPerPage: 25,
    // Default 1.0 (= 100 %). Historicky bylo 1.2 kvůli 4K @ 125 %, ale na malých
    // obrazovkách (notebook 1366×768 / 1920×1080 s vyšším Windows scaling) se
    // sidebar nevejde a Import playlist tlačítko končí pod foldem. `{...def,
    // ...parsed}` níž zajistí, že kdo má vlastní hodnotu uloženou, tomu zůstane
    // (včetně těch, co historicky zdědili 1.2 — nepřepíšeme je násilím).
    // macOS má typicky Retina displej + jiné DPI chování než Windows — 100 % tam
    // působí o kus větší. Default 0.9 UI na Macu srovná pocitovou velikost.
    // (Uložená hodnota uživatele má přednost přes `{...def, ...parsed}` níž.)
    uiScale: isMac ? 0.9 : 1.0,
    hotkeys: {
      // Show / hide window — rychlý toggle. Na macu Command+I (nativní modifikátor),
      // na Windows Control+I. Nepřekrývá běžné herní bindings v CH.
      toggleOverlay: isMac ? 'Command+I' : 'Control+I'
    },
    showTips: true, // rotující tipy v liště (uživatel může vypnout)
    showReminder: false, // opt-in
    reminderPosition: 'bottom-right',
    dupMoveDir: '', // poslední karanténní složka pro duplicity
    // Šablona složky chartu — výchozí hodnota je PŘESNĚ ten formát, který byl do
    // 0.9.6 natvrdo v `install()`, a auto je vypnuté → kdo si nic nenastaví, má
    // bit-identické chování jako dřív (i po aktualizaci; `{...def, ...parsed}`
    // níže dosadí tyhle defaulty do starých configů, které pole ještě nemají).
    folderTemplate: DEFAULT_FOLDER_TEMPLATE,
    autoTargetFolder: false,
    // Auto-check nových verzí při startu — dosavadní chování. Kdo nechce být
    // upozorňován (blikající banner vlevo dole), si to v Nastavení vypne a
    // update si zjistí ručně přes „Check for updates".
    autoCheckUpdates: true
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
