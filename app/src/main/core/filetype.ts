// Detekce typů souborů (CON/LIVE balíčky vs. ostatní).

import { openSync, readSync, closeSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/** Přečte první 4 bajty souboru jako ASCII (magic). */
function magic(path: string): string {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(4)
    readSync(fd, buf, 0, 4, 0)
    return buf.toString('latin1')
  } catch {
    return ''
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** True, pokud je soubor Xbox STFS balíček (CON/LIVE/PIRS) – tj. Rock Band CON. */
export function isConFile(path: string): boolean {
  const lower = path.toLowerCase()
  if (lower.endsWith('.rb3con') || lower.endsWith('.con')) return true
  const m = magic(path)
  return m === 'CON ' || m === 'LIVE' || m === 'PIRS'
}

/**
 * Detekuje archiv podle magic bytů (spolehlivější než přípona — Google Drive
 * stahuje soubory bez přípony). Vrací true pro zip/7z/rar/gzip.
 */
export function isArchiveByMagic(path: string): boolean {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(6)
    readSync(fd, buf, 0, 6, 0)
    // ZIP: 50 4B  | 7z: 37 7A BC AF 27 1C | RAR: 52 61 72 21 | GZIP: 1F 8B
    if (buf[0] === 0x50 && buf[1] === 0x4b) return true
    if (buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return true
    if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return true
    if (buf[0] === 0x1f && buf[1] === 0x8b) return true
    return false
  } catch {
    return false
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** True, pokud soubor začíná jako HTML (odkaz vrátil webovou stránku, ne song). */
export function isHtmlFile(path: string): boolean {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(64)
    const n = readSync(fd, buf, 0, 64, 0)
    const head = buf.toString('latin1', 0, n).trim().toLowerCase()
    return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')
  } catch {
    return false
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Najde všechny CON balíčky v adresářovém stromu. */
export function findConFiles(root: string, maxDepth = 6): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full, depth + 1)
      else if (st.isFile() && st.size > 0 && isConFile(full)) out.push(full)
    }
  }
  const st = (() => {
    try {
      return statSync(root)
    } catch {
      return null
    }
  })()
  if (st?.isFile()) {
    if (isConFile(root)) out.push(root)
  } else {
    walk(root, 0)
  }
  return out
}

/**
 * Najde vstupní body pro DTXMania konverzi ve stromu.
 * - Preferuje `set.def` (import celé sady = Expert + autogen nižší obtížnosti);
 *   jeden set.def = jedna píseň (packy mají víc podsložek).
 * - Když žádný set.def není, vezme jeden `.dtx`/`.gda` na složku (soubory v jedné
 *   složce jsou obtížnosti jedné písně → jinak by vznikly duplikáty).
 */
export function findDtxEntries(root: string, maxDepth = 6): string[] {
  const setDefs: string[] = []
  const dtxByDir = new Map<string, string>()
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full, depth + 1)
      } else if (st.isFile() && st.size > 0) {
        const lower = name.toLowerCase()
        if (lower === 'set.def') setDefs.push(full)
        else if ((lower.endsWith('.dtx') || lower.endsWith('.gda')) && !dtxByDir.has(dir)) {
          dtxByDir.set(dir, full)
        }
      }
    }
  }
  walk(root, 0)
  return setDefs.length > 0 ? setDefs : [...dtxByDir.values()]
}
